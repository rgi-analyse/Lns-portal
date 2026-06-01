import { prisma } from '../lib/prisma';
import { queryAzureSQLForTenant } from '../services/azureSqlService';
import { kjørBlokkerende } from '../services/openaiService';
import { lagGrafPng, type GrafSpec, type GrafFarger } from '../services/grafService';
import { lastOppBlob, lastNedBlob } from '../services/blobService';
import { byggWordRapport, byggDokumentNavn, type WordSeksjon } from '../services/wordService';

// Statusverdier som matcher CHECK_ai_analyse_bestilling_status i DB
const STATUS = {
  BESTILT:    'BESTILT',
  KJORER:     'KJORER',  // NB: uten Ø — DB-constraint tillater ikke Ø
  FERDIG:     'FERDIG',
  FEILET:     'FEILET',
  KANSELLERT: 'KANSELLERT',
} as const;

/**
 * Formaterer en verdi for visning i markdown-tabell.
 * Tall vises med opptil 2 desimaler (norsk format).
 * Datoer ISO-formateres. null/undefined blir tom streng.
 */
function formaterVerdi(verdi: unknown): string {
  if (verdi === null || verdi === undefined) return '';
  if (typeof verdi === 'number') {
    // Behold tall som tall — AI håndterer formatering selv (testet OK i D1)
    return String(verdi);
  }
  if (verdi instanceof Date) {
    return verdi.toISOString().substring(0, 10);  // YYYY-MM-DD
  }
  // Strip newlines i strenger så markdown-tabellen ikke brytes
  return String(verdi).replace(/[\r\n|]/g, ' ').trim();
}

/**
 * Mapper rapportStruktur.graf-config til GrafSpec som grafService forstår.
 * Returnerer null hvis graf-config er ugyldig eller mangler påkrevde felt.
 */
function mapTilGrafSpec(graf: any): GrafSpec | null {
  if (!graf || typeof graf !== 'object' || !graf.type) {
    return null;
  }

  switch (graf.type) {
    case 'bar_vertikal':
      if (!graf.x || !graf.y) return null;
      return {
        type: 'bar_vertikal',
        xKolonne: graf.x,
        yKolonne: graf.y,
        tittel: graf.tittel,
        xFormat: graf.x_format,
      };

    case 'bar_horisontal':
      if (!graf.x || !graf.y) return null;
      return {
        type: 'bar_horisontal',
        xKolonne: graf.x,
        yKolonne: graf.y,
        tittel: graf.tittel,
      };

    case 'pie':
      if (!graf.label || !graf.verdi) return null;
      return {
        type: 'pie',
        labelKolonne: graf.label,
        verdiKolonne: graf.verdi,
        tittel: graf.tittel,
      };

    default:
      return null;  // ukjent graf-type, skip
  }
}

/**
 * Hovedflyt for én analyse-bestilling.
 * Henter eldste BESTILT på tvers av tenants, markerer som KJORER med
 * optimistic lock, og logger plukkingen. Faktisk prosessering kommer i Steg B3.
 */
export async function kjørOrchestrator(): Promise<void> {
  const bestilling = await prisma.analyseBestilling.findFirst({
    where:   { status: STATUS.BESTILT },
    orderBy: { bestiltDato: 'asc' },
    select: {
      id:            true,
      analyseTypeId: true,
      brukerId:      true,
      tenantSlug:    true,
      bestiltDato:   true,
      forsokAntall:  true,
      parametre:     true,
    },
  });

  if (!bestilling) {
    console.log('[Orchestrator] Ingen ventende bestillinger');
    return;
  }

  console.log(
    `[Orchestrator] Plukket opp bestilling ${bestilling.id} ` +
    `(type: ${bestilling.analyseTypeId}, tenant: ${bestilling.tenantSlug})`,
  );

  // Optimistic lock: oppdater kun hvis status fortsatt er BESTILT —
  // hindrer at to instanser plukker samme rad samtidig.
  const oppdatert = await prisma.analyseBestilling.updateMany({
    where: { id: bestilling.id, status: STATUS.BESTILT },
    data: {
      status:       STATUS.KJORER,
      startetDato:  new Date(),
      forsokAntall: { increment: 1 },
    },
  });

  if (oppdatert.count === 0) {
    console.log(`[Orchestrator] ${bestilling.id} ble plukket av annen instans, hopper over`);
    return;
  }

  const nyttForsøk = bestilling.forsokAntall + 1;
  console.log(`[Orchestrator] Markerte ${bestilling.id} som ${STATUS.KJORER} (forsøk ${nyttForsøk})`);

  // STEG C: DATAFASE
  try {
    console.log(`[Orchestrator] Steg C: starter datafase for ${bestilling.id}`);

    // 1. Hent analyse-type fra master-prisma
    const analyseType = await prisma.analyseType.findUnique({
      where: { id: bestilling.analyseTypeId },
    });
    if (!analyseType) {
      throw new Error(`Analyse-type ikke funnet: ${bestilling.analyseTypeId}`);
    }
    if (!analyseType.datakilder) {
      throw new Error(`Analyse-type ${bestilling.analyseTypeId} har ingen datakilder definert`);
    }

    // 2. Hent tenant-DB-URL
    const tenant = await prisma.tenant.findFirst({
      where: { slug: bestilling.tenantSlug },
    });
    if (!tenant || !tenant.databaseUrl) {
      throw new Error(`Tenant eller databaseUrl mangler for slug: ${bestilling.tenantSlug}`);
    }

    // 3. Parse datakilder og parametre
    const datakilder = JSON.parse(analyseType.datakilder);
    if (!Array.isArray(datakilder.queries)) {
      throw new Error(`Datakilder mangler queries-array for ${bestilling.analyseTypeId}`);
    }

    const parametre = JSON.parse(bestilling.parametre || '{}');
    console.log(`[Orchestrator] Parametre:`, Object.keys(parametre).join(', '));
    console.log(`[Orchestrator] Kjører ${datakilder.queries.length} queries`);

    // 4. Kjør alle queries (strict — feil i én avbryter alt)
    const dataResultater: Record<string, any[]> = {};
    for (const kilde of datakilder.queries) {
      console.log(`[Orchestrator] Query: ${kilde.id} — ${kilde.beskrivelse || ''}`);

      // Bygg parametre for denne query-en
      const queryParams: Record<string, any> = {};
      for (const paramNavn of (kilde.parametre || [])) {
        queryParams[paramNavn] = parametre[paramNavn] ?? null;
      }

      const rader = await queryAzureSQLForTenant(
        tenant.databaseUrl,
        kilde.sql,
        queryParams,
      );
      dataResultater[kilde.id] = rader;
      console.log(`[Orchestrator]   → ${rader.length} rader`);
    }

    // 5. Bygg sammendrag-tekst
    const detaljer = Object.entries(dataResultater)
      .map(([id, rader]) => `${id}=${rader.length}`)
      .join(', ');
    const totalRader = Object.values(dataResultater).reduce((sum, r) => sum + r.length, 0);

    console.log(`[Orchestrator] Datafase ferdig: ${detaljer} (totalt ${totalRader} rader)`);

    // STEG D: AI-FASE
    console.log(`[Orchestrator] Steg D: starter AI-fase for ${bestilling.id}`);

    // 6a. Parse rapportStruktur og modellPreferanse
    if (!analyseType.rapportStruktur) {
      throw new Error(`Analyse-type ${bestilling.analyseTypeId} har ingen rapportStruktur definert`);
    }

    const rapportStruktur = JSON.parse(analyseType.rapportStruktur);
    if (!Array.isArray(rapportStruktur.seksjoner)) {
      throw new Error(`rapportStruktur mangler seksjoner-array for ${bestilling.analyseTypeId}`);
    }

    // systemPrompt fra analyseType (kan være null — bruk fallback)
    const systemPrompt = analyseType.systemPrompt
      ?? 'Du er en analytiker. Skriv kortfattet og presist på norsk.';

    // modellPreferanse fra analyseType (kan være null — bruk defaults)
    const modellPrefRaw = analyseType.modellPreferanse;
    const modellPref = modellPrefRaw ? JSON.parse(modellPrefRaw) : {};
    const aiOpts = {
      modell: modellPref.primar,  // undefined => helperen bruker default fra env
      temperatur: modellPref.temperatur ?? 0.3,
      maksTokens: modellPref.maks_tokens ?? 2000,
    };

    console.log(`[Orchestrator] AI-konfig: modell=${aiOpts.modell ?? 'env-default'}, temp=${aiOpts.temperatur}, maksTokens=${aiOpts.maksTokens}`);

    // 6b. Sorter seksjoner på rekkefolge
    const sorterteSeksjoner = [...rapportStruktur.seksjoner].sort(
      (a, b) => (a.rekkefolge ?? 999) - (b.rekkefolge ?? 999),
    );

    // 6c. Iterere seksjoner og generer AI-tekst
    const aiSeksjoner: Record<string, string> = {};
    const hoppetOver: string[] = [];
    let tokenForbrukTotal = 0;
    let modellSomBleBrukt = '';

    for (const seksjon of sorterteSeksjoner) {
      // Skipp seksjoner som kun viser grafer (ingen tekst)
      if (seksjon.type === 'graf') {
        console.log(`[Orchestrator] Seksjon ${seksjon.id}: skipper (kun graf, ingen tekst)`);
        hoppetOver.push(seksjon.id);
        continue;
      }

      console.log(`[Orchestrator] Seksjon ${seksjon.id}: bygger prompt`);

      // Bygg brukerPrompt
      let brukerPrompt: string;

      if (!seksjon.queries || seksjon.queries.length === 0) {
        // Spesialcase: seksjoner uten direkte queries (f.eks. anbefalinger)
        // De får forrige seksjoners tekst som kontekst
        const tidligereTekster = Object.entries(aiSeksjoner)
          .map(([id, tekst]) => `## ${id}\n${tekst}`)
          .join('\n\n');

        brukerPrompt = `Du har tidligere skrevet disse seksjonene basert på data:\n\n${tidligereTekster}\n\n## Din oppgave nå\n${seksjon.instruks}`;
      } else {
        // Normal: bygg fra queries
        const dataDeler: string[] = [];
        for (const queryId of seksjon.queries) {
          const rader = dataResultater[queryId];
          if (!rader || rader.length === 0) {
            dataDeler.push(`## ${queryId}\n(ingen data)`);
            continue;
          }

          // Bygg markdown-tabell
          const kolonner = Object.keys(rader[0]);
          const header = `| ${kolonner.join(' | ')} |`;
          const separator = `| ${kolonner.map(() => '---').join(' | ')} |`;
          const radLinjer = rader.map(r =>
            `| ${kolonner.map(k => formaterVerdi(r[k])).join(' | ')} |`,
          );

          dataDeler.push(`## ${queryId}\n${header}\n${separator}\n${radLinjer.join('\n')}`);
        }

        brukerPrompt = `Du har følgende data å analysere:\n\n${dataDeler.join('\n\n')}\n\n## Din oppgave\n${seksjon.instruks}`;
      }

      // Kall AI
      const start = Date.now();
      const resultat = await kjørBlokkerende(systemPrompt, brukerPrompt, aiOpts);
      const latens = Date.now() - start;

      console.log(`[Orchestrator] Seksjon ${seksjon.id}: ferdig (${resultat.totaltTokens} tokens, ${latens}ms)`);

      aiSeksjoner[seksjon.id] = resultat.tekst;
      tokenForbrukTotal += resultat.totaltTokens;
      modellSomBleBrukt = resultat.modell;
    }

    console.log(`[Orchestrator] AI-fase ferdig: ${Object.keys(aiSeksjoner).length} seksjoner generert (${hoppetOver.length} hoppet over), totalt ${tokenForbrukTotal} tokens`);

    // STEG E: GRAF-FASE
    console.log(`[Orchestrator] Steg E: starter graf-fase for ${bestilling.id}`);

    // Hent tenant-tema (global — én rad i OrganisasjonTema)
    const tema = await prisma.organisasjonTema.findFirst({
      orderBy: { opprettet: 'asc' },
    });

    const grafFarger: GrafFarger = {
      primær:     tema?.primaryColor    ?? '#F5A623',
      bakgrunn:   tema?.backgroundColor ?? '#0a1628',
      navy:       tema?.navyColor       ?? '#1B2A4A',
      aksent:     tema?.accentColor     ?? '#243556',
      tekst:      tema?.textColor       ?? '#FFFFFF',
      tekstMuted: tema?.textMutedColor  ?? 'rgba(255,255,255,0.55)',
    };

    console.log(`[Orchestrator] Tema lastet: primær=${grafFarger.primær}, bakgrunn=${grafFarger.bakgrunn}`);

    const aiGrafer: Record<string, string> = {};

    for (const seksjon of sorterteSeksjoner) {
      // Skip seksjoner uten graf-spec
      const grafSpec = mapTilGrafSpec(seksjon.graf);
      if (!grafSpec) {
        continue;
      }

      // Hent data fra første query i seksjonens queries-liste
      if (!seksjon.queries || seksjon.queries.length === 0) {
        console.log(`[Orchestrator] Seksjon ${seksjon.id}: graf-spec finnes men ingen queries, skipper graf`);
        continue;
      }

      const queryId = seksjon.queries[0];
      const data = dataResultater[queryId];

      if (!data || data.length === 0) {
        console.log(`[Orchestrator] Seksjon ${seksjon.id}: graf-data tom (query ${queryId}), skipper graf`);
        continue;
      }

      console.log(`[Orchestrator] Genererer graf for seksjon ${seksjon.id} (type: ${grafSpec.type}, ${data.length} rader)`);

      // Generer PNG
      const pngBuffer = await lagGrafPng(grafSpec, data, grafFarger);
      console.log(`[Orchestrator] Graf ${seksjon.id}: ${pngBuffer.length} bytes`);

      // Last opp til blob
      const blobSti = `${bestilling.id}/grafer/${seksjon.id}.png`;
      const uploadResultat = await lastOppBlob(pngBuffer, blobSti, 'image/png');

      aiGrafer[seksjon.id] = uploadResultat.blobSti;
      console.log(`[Orchestrator] Graf ${seksjon.id}: opplastet til ${uploadResultat.blobSti}`);
    }

    console.log(`[Orchestrator] Graf-fase ferdig: ${Object.keys(aiGrafer).length} grafer generert og opplastet`);

    // STEG F: WORD-RAPPORT
    console.log(`[Orchestrator] Steg F: starter Word-generering for ${bestilling.id}`);

    const tenantNavn = tema?.organisasjonNavn ?? 'LNS';

    // Undertittel: "Prosjekt X · 1. jan – 31. mar 2026" (norsk dato-range).
    const datoRange = (fra?: string, til?: string): string => {
      const f = fra ? new Date(fra) : null;
      const t = til ? new Date(til) : null;
      const dm  = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' });
      const dmy = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
      if (f && t) return `${dm.format(f)} – ${dmy.format(t)}`;
      if (f) return dmy.format(f);
      if (t) return dmy.format(t);
      return '';
    };
    const prosjektDel = parametre.prosjekt ? `Prosjekt ${parametre.prosjekt}` : '';
    const rangeDel = datoRange(parametre.fraDato, parametre.tilDato);
    const undertittel = [prosjektDel, rangeDel].filter(Boolean).join(' · ') || undefined;

    // Bygg seksjoner i rekkefølge — ta med alle som har tekst ELLER graf.
    // Graf-only-seksjoner (type='graf' uten AI-tekst) får tom markdown og
    // kun H1 + bilde i Word — wordService håndterer tom tekst defensivt.
    const wordSeksjoner: WordSeksjon[] = [];
    for (const seksjon of sorterteSeksjoner) {
      const tekst   = aiSeksjoner[seksjon.id];
      const grafSti = aiGrafer[seksjon.id];
      if (!tekst && !grafSti) continue;
      const grafPng = grafSti ? await lastNedBlob(grafSti) : undefined;
      wordSeksjoner.push({
        tittel: seksjon.tittel
          ?? (String(seksjon.id).charAt(0).toUpperCase() + String(seksjon.id).slice(1)),
        markdownTekst: tekst ?? '',
        grafPng,
      });
    }

    const docxBuffer = await byggWordRapport({
      tittel:       analyseType.navn,
      undertittel,
      tenantNavn,
      generertDato: new Date(),
      seksjoner:    wordSeksjoner,
      temaPrimaer:  tema?.primaryColor ?? '#F5A623',
      temaNavy:     tema?.navyColor    ?? '#1B2A4A',
    });

    const docxSti = `${bestilling.id}/rapport.docx`;
    await lastOppBlob(
      docxBuffer,
      docxSti,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const dokumentNavn = byggDokumentNavn(
      { id: analyseType.id, navn: analyseType.navn },
      parametre,
      new Date(),
    );
    console.log(`[Orchestrator] Steg F ferdig: ${docxBuffer.length} bytes → ${docxSti} (${dokumentNavn})`);

    // 6d. Bygg JSON for sammendrag-kolonnen
    const sammendragsObjekt = {
      seksjoner: aiSeksjoner,
      grafer: aiGrafer,  // NY: blob-paths per seksjon
      metadata: {
        totalRaderData: totalRader,
        datakildeDetaljer: detaljer,
        tokenForbrukTotal,
        modellBrukt: modellSomBleBrukt,
        genererte: Object.keys(aiSeksjoner),
        hoppetOver,
        grafer: Object.keys(aiGrafer),  // NY: hvilke grafer som ble laget
      },
    };

    // 6e. Marker som FERDIG.
    // Trygt å bruke update (ikke updateMany): vi har allerede vunnet optimistic lock ovenfor.
    await prisma.analyseBestilling.update({
      where: { id: bestilling.id },
      data: {
        // NB: tittel skrives IKKE — det er brukerens valgfrie felt fra POST,
        // skal aldri overskrives av workeren. Fallback til analyseType.navn +
        // parametre håndteres i frontend når feltet er null.
        status:       STATUS.FERDIG,
        ferdigDato:   new Date(),
        sammendrag:   JSON.stringify(sammendragsObjekt),
        tokenForbruk: tokenForbrukTotal,
        modellBrukt:  modellSomBleBrukt,
        dokumentUrl:  docxSti,        // blob-sti (ikke full URL — Beslutning #5)
        dokumentNavn,
      },
    });

    console.log(`[Orchestrator] Markerte ${bestilling.id} som ${STATUS.FERDIG} (Steg F — Word-rapport generert)`);

  } catch (error) {
    console.error(`[Orchestrator] Feil i datafase for ${bestilling.id}:`, error);

    await prisma.analyseBestilling.update({
      where: { id: bestilling.id },
      data: {
        status:      STATUS.FEILET,
        ferdigDato:  new Date(),
        feilmelding: error instanceof Error
          ? `${error.message}\n\n${error.stack}`
          : String(error),
      },
    });

    console.log(`[Orchestrator] Markerte ${bestilling.id} som ${STATUS.FEILET}`);
  }
}
