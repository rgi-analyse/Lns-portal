import { prisma } from '../lib/prisma';
import { queryAzureSQLForTenant } from '../services/azureSqlService';

// Statusverdier som matcher CHECK_ai_analyse_bestilling_status i DB
const STATUS = {
  BESTILT:    'BESTILT',
  KJORER:     'KJORER',  // NB: uten Ø — DB-constraint tillater ikke Ø
  FERDIG:     'FERDIG',
  FEILET:     'FEILET',
  KANSELLERT: 'KANSELLERT',
} as const;

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

    // 6. Marker som FERDIG (placeholder for dokument — Word-generering kommer i Steg E/F).
    // Trygt å bruke update (ikke updateMany): vi har allerede vunnet optimistic lock ovenfor.
    await prisma.analyseBestilling.update({
      where: { id: bestilling.id },
      data: {
        status:       STATUS.FERDIG,
        ferdigDato:   new Date(),
        tittel:       `Datafase fullført: ${bestilling.analyseTypeId}`,
        sammendrag:   `Hentet ${Object.keys(dataResultater).length} datakilder, totalt ${totalRader} rader. Detaljer: ${detaljer}. AI-generering kommer i Steg D.`,
        tokenForbruk: 0,
        modellBrukt:  'steg-c-data-kun',
      },
    });

    console.log(`[Orchestrator] Markerte ${bestilling.id} som ${STATUS.FERDIG} (Steg C — data hentet)`);

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
