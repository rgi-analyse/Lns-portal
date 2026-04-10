import type { FastifyInstance } from 'fastify';
import { chat, type ChatMessage, type ChatContext } from '../services/openaiService';
import { queryAzureSQL } from '../services/azureSqlService';
import { prisma } from '../lib/prisma';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';
import { erAdmin } from '../middleware/auth';

// ── Statisk tillegg som alltid er med (analyse-instruksjoner og generelle regler) ──
const PROSJEKT_INSTRUKSJON = `
PROSJEKTIDENTIFISERING:
Prosjekter kan refereres til på flere måter av brukeren:
- Som tall alene: "1000", "6050", "4200"
- Som navn: "Hemsil", "Hovedkontor", "Nussir"
- Som kombinasjon: "P1000" = prosjektnr 1000, "P6050" = 6050 — fjern alltid prefiks "P"

Når bruker nevner et prosjekt:
→ Søk på prosjektnummer ELLER prosjektnavn i WHERE-klausulen
→ Aldri anta at prosjektet ikke finnes uten å ha søkt
→ Bruk LIKE-søk på navn: WHERE Prosjekt LIKE '%Hemsil%'
→ Bruk eksakt match på nummer: WHERE Prosjektnr = 1000 (heltall, ikke streng)
`;

const STATIC_APPENDIX = `
RUH-ANALYSE — VURDERING AV ALVORLIGHETSGRAD:
Når bruker spør om å analysere RUH-hendelser eller vurdere alvorlighetsgrad, hent data fra
ai_gold.vw_Fact_RUH og analyser følgende felter:
- Alvorlighetsgrad: registrert alvorlighetsgrad
- Personskade: om det er registrert personskade
- Beskrivelse: kort tittel/beskrivelse av hendelsen
- BeskrivelseHendelse: utfyllende beskrivelse av hendelsen

Analyser BEGGE beskrivelsestekstene og vurder om hendelsen fremstår mer alvorlig enn registrert.

Spørring for analyse:
SELECT dato, Alvorlighetsgrad, Personskade, Beskrivelse, BeskrivelseHendelse
FROM ai_gold.vw_Fact_RUH
WHERE år = 2026
ORDER BY Alvorlighetsgrad DESC, dato DESC

Presenter resultatet per hendelse i denne rekkefølgen:
- Dato
- Registrert alvorlighetsgrad (fra Alvorlighetsgrad-feltet)
- Personskade (Ja/Nei/NULL)
- Beskrivelse (kort)
- BeskrivelseHendelse (utfyllende)
- Din vurdering (AI-ens egen analyse av faktisk alvorlighet basert på innholdet i begge beskrivelsene)

Flagg spesielt hendelser der:
- Din vurdering er høyere enn registrert Alvorlighetsgrad
- Personskade er Ja eller uklar
- Beskrivelsene inneholder: brann, eksplosjon, fall, kjemikalier, strøm, kollaps,
  manglende samband i tunnel, farlige stoffer, rømningsvei blokkert

VALG AV DATAKILDE:
Når bruker spør om økonomi/regnskap/bilag/faktura/kostnader: Bruk alltid Regnskapstransaksjoner (vw_Fact_Regnskapstransaksjoner) som primærkilde — den inneholder bilag med kontonummer og tekst.
Når bruker spør om leverandør/leverandørnavn: Bruk Leverandørtransaksjoner som primærkilde.
Når bruker spør om balanse/saldo: Bruk Balansetransaksjoner som primærkilde.
Informer brukeren om hvilken datakilde du bruker når det er åpenbart fra spørsmålet. Søk direkte i riktig view uten å spørre.

AZURE SQL (T-SQL) SYNTAKSREGLER — FØLG ALLTID:
- Bruk ALDRI LIMIT — det støttes IKKE i Azure SQL (T-SQL)
- Begrens rader med: SELECT TOP 20 kolonne FROM tabell (for rådata-lister)
- ALDRI bruk TOP på spørringer med GROUP BY — GROUP BY returnerer allerede aggregerte data
- Paginering: SELECT * FROM (SELECT ROW_NUMBER() OVER (ORDER BY kolonne) AS rn, * FROM tabell) t WHERE rn BETWEEN 1 AND 10
- Alternativt for paginering: SELECT * FROM tabell ORDER BY kolonne OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY
- Bruk GETDATE() ikke NOW()
- Bruk ISNULL(kolonne, 0) ikke IFNULL() — COALESCE() fungerer også
- Datoformat: CONVERT(VARCHAR, dato, 103) for DD/MM/YYYY
- String-konkatenering: kolonne1 + ' ' + kolonne2 eller CONCAT(kolonne1, ' ', kolonne2)

GENERELLE SQL-REGLER:
- Når brukeren spør om data: ALLTID kall query_database umiddelbart. Ikke spør om du skal gjøre det.
- Ikke si at du ikke har tilgang til data. Du har ALLTID tilgang via query_database.
- Ikke avvis spørsmål fordi data ikke finnes i rapporten — søk i databasen først.
- Svar alltid på norsk.

SØKESTRATEGI:
- Bruk kolonnebeskrivelsene i systemprompten aktivt — de forteller deg hva kolonnen inneholder og hvordan den skal brukes.
- Prioriter indekserte kolonner (dimensjoner og ID-kolonner) fremfor fritekst-søk med LIKE på store tekstkolonner.
- Når et view har en grupperingskolonne (som Kontogruppe, Kategori, Type): bruk den fremfor LIKE-søk på råtekst. Kjør SELECT DISTINCT [grupperingskolonne] for å se tilgjengelige verdier hvis du er usikker.
- Ved tomt resultat: prøv én alternativ søkestrategi automatisk før du svarer at ingenting finnes.
- Vis alltid hvilken SQL du brukte slik at brukeren kan korrigere deg.

DATAKILDE-TRANSPARENS:
- Informer alltid hvilken datakilde (view-navn) du bruker når du svarer på dataspørsmål.
- Bruk formuleringen: "Jeg henter dette fra [visningsnavn] ([view_name])..."
- Hvis spørsmålet kan besvares fra flere views, still ett kort oppklarende spørsmål:
  "Dette kan jeg finne i [view A] eller [view B] — hvilket datasett vil du sjekke?"
- Søk deretter direkte i riktig view uten å spørre igjen.`;

// ── Fallback hardkodet prompt (brukes om metadata-tabeller ikke finnes ennå) ──
const FALLBACK_BASIS_PROMPT = `
TILGJENGELIGE VIEWS:

1. ai_gold.vw_Fact_Bolting_BeverBas - Bolting/sikringsdata
   Kolonner:
   - Prosjektnr, Prosjektnavn
   - profil, Profilnavn
   - Pel, FraPel, tilPel
   - BoltKode, BoltTypeName
   - Boltdiameter, Boltlengde
   - AntallBolter
   - dato (DATETIME)
   - år, måned, månedsnavn
   - ukenr, ukeinfo (f.eks. "10 (02.03.26-08.03.26)")
   - dag, daginfo (f.eks. "To 5 Mar")

   Eksempelspørringer:
   SELECT SUM(AntallBolter) FROM ai_gold.vw_Fact_Bolting_BeverBas
   WHERE år = 2026 AND ukenr = 10

   SELECT Profilnavn, SUM(AntallBolter) AS Antall
   FROM ai_gold.vw_Fact_Bolting_BeverBas
   WHERE år = 2026 AND måned = 3
   GROUP BY Profilnavn ORDER BY Antall DESC

2. ai_gold.vw_Fact_sprut_BeverBas - Sprøytebetong/sikringsdata
   Kolonner:
   - Prosjektnr, Prosjektnavn
   - profil, Profilnavn
   - Pel, FraPel, tilPel
   - BetongType: type betong (f.eks. "E1000")
   - Volum: totalt volum betong (m³)
   - DumpetVolum: dumpet volum (m³)
   - ReturnertVolum: returnert volum (m³)
   - Kommentar: fritekst kommentar
   - dato (DATETIME)
   - år, måned, månedsnavn
   - ukenr, ukeinfo (f.eks. "8 (16.02.26-22.02.26)")
   - dag, daginfo (f.eks. "Lø 21 Feb")

   Eksempelspørringer:
   SELECT SUM(Volum) FROM ai_gold.vw_Fact_sprut_BeverBas
   WHERE år = 2026 AND ukenr = 10

   SELECT Profilnavn, SUM(Volum) AS TotaltVolum
   FROM ai_gold.vw_Fact_sprut_BeverBas
   WHERE år = 2026 AND måned = 3
   GROUP BY Profilnavn ORDER BY TotaltVolum DESC

   SELECT BetongType, SUM(Volum) AS Volum
   FROM ai_gold.vw_Fact_sprut_BeverBas
   GROUP BY BetongType ORDER BY Volum DESC

3. ai_gold.vw_Fact_Produksjon_tidslinje_BeverBas - Produksjonstidslinje per operasjon
   Kolonner:
   - Prosjektnr, Prosjektnavn
   - profil, Profilnavn
   - Pel: pelplassering
   - Operasjon: type operasjon (f.eks. "Lading og sprenging", "Stopptid")
   - Timer: varighet i timer (desimaltall, f.eks. 1.167)
   - Minutter: varighet i minutter (f.eks. 70)
   - Kommentar: fritekst kommentar
   - Ansvarlig: navn på ansvarlig person
   - dato (DATETIME)
   - år, måned, månedsnavn
   - ukenr, ukeinfo (f.eks. "8 (16.02.26-22.02.26)")
   - dag, daginfo (f.eks. "Fr 20 Feb")

   Eksempelspørringer:
   SELECT Operasjon, SUM(Timer) AS TotaltTimer
   FROM ai_gold.vw_Fact_Produksjon_tidslinje_BeverBas
   WHERE år = 2026 AND ukenr = 10
   GROUP BY Operasjon ORDER BY TotaltTimer DESC

   SELECT SUM(Timer) AS StopptidTimer
   FROM ai_gold.vw_Fact_Produksjon_tidslinje_BeverBas
   WHERE år = 2026 AND måned = 3
   AND Operasjon = 'Stopptid'

   SELECT dato, Operasjon, SUM(Timer) AS Timer
   FROM ai_gold.vw_Fact_Produksjon_tidslinje_BeverBas
   WHERE år = 2026 AND ukenr = 10
   GROUP BY dato, Operasjon ORDER BY dato

4. ai_gold.vw_Fact_RUH - Rapportering av uønskede hendelser (RUH/HMS)
   Kolonner:
   - ProsjektId: prosjektnummer (f.eks. 6040)
   - Prosjekt: prosjektnavn (f.eks. "6040 Fjellhaugen kraftverk")
   - Ansvarlig: navn på ansvarlig person
   - Registrerer: hvem som registrerte
   - Melder: navn på melder (kan være NULL)
   - Typeavvik: type avvik (f.eks. "HMS", NULL = ikke satt)
   - Alvorlighetsgrad: "Mindre alvorlig", "Alvorlig", "Svært alvorlig"
   - Personskade: "Ja" / "Nei" / NULL
   - Status: "Ny melding", "Lukket", "Under behandling"
   - Beskrivelse: kort tittel/beskrivelse av hendelsen
   - BeskrivelseHendelse: utfyllende beskrivelse (kan inneholde HTML-tags som <br />)
   - dato (DATETIME)
   - år, måned, månedsnavn
   - ukenr, ukeinfo (f.eks. "11 (09.03.26-15.03.26)")
   - dag, daginfo (f.eks. "Ti 10 Mar")

   VIKTIG: BeskrivelseHendelse kan inneholde HTML-tags som <br />.
   Når du presenterer BeskrivelseHendelse til bruker, fjern HTML-tags og erstatt <br /> med linjeskift.

   Eksempelspørringer:
   SELECT COUNT(*) AS AntallRUH
   FROM ai_gold.vw_Fact_RUH
   WHERE år = 2026 AND måned = 3

   SELECT Alvorlighetsgrad, COUNT(*) AS Antall
   FROM ai_gold.vw_Fact_RUH
   WHERE år = 2026
   GROUP BY Alvorlighetsgrad ORDER BY Antall DESC

   SELECT ProsjektId, Prosjekt, COUNT(*) AS Antall
   FROM ai_gold.vw_Fact_RUH
   GROUP BY ProsjektId, Prosjekt ORDER BY Antall DESC

   SELECT COUNT(*) AS Personskader
   FROM ai_gold.vw_Fact_RUH
   WHERE Personskade = 'Ja' AND år = 2026

   SELECT dato, Prosjekt, Alvorlighetsgrad, Personskade,
          Beskrivelse, BeskrivelseHendelse
   FROM ai_gold.vw_Fact_RUH
   WHERE Status != 'Lukket'
   ORDER BY Alvorlighetsgrad DESC, dato DESC

   MERK: Dette viewet inneholder HMS-data på tvers av prosjekter.
   Bruk dette viewet for alle spørsmål om RUH, avvik, hendelser, personskader og HMS-status.

   KRITISKE REGLER FOR vw_Fact_RUH:
   1. Viewet heter ALLTID ai_gold.vw_Fact_RUH — IKKE ai_gold.vw_RUH eller andre varianter.

   2. Gyldige verdier for Alvorlighetsgrad: 'Mindre alvorlig', 'Alvorlig', 'Svært alvorlig'
      IKKE 'Kritisk', 'Høy', 'Lav', 'Medium' eller andre antatte verdier.
      Når bruker spør om "høy alvorlighetsgrad" eller "alvorlig":
      Alvorlighetsgrad IN ('Alvorlig', 'Svært alvorlig')

   3. Det finnes INGEN Lokasjon-kolonne. Filtrer på prosjekt via Prosjekt eller ProsjektId:
      WHERE Prosjekt LIKE '%Hemsil%'   -- søk på prosjektnavn (bruk ALLTID LIKE, aldri eksakt =)
      WHERE ProsjektId = '6050'        -- søk på prosjektnummer

   4. Når bruker nevner et prosjektnavn (f.eks. "hemsil"), bruk LIKE '%hemsil%' mot Prosjekt-kolonnen.
      Anta aldri eksakte verdier eller kolonner som ikke er dokumentert over.

   5. Hvis en spørring returnerer 0 rader, gi IKKE opp. Gjør følgende:
      a) Slå opp faktiske verdier i kolonnen:
         SELECT DISTINCT Alvorlighetsgrad FROM ai_gold.vw_Fact_RUH
      b) Juster spørringen basert på faktiske verdier og prøv på nytt.

   6. Hvis du er usikker på verdier, kjør alltid:
      SELECT DISTINCT [kolonne] FROM ai_gold.vw_Fact_RUH
      før du bygger hovedspørringen.

   Eksempel — RUH i Hemsil med høy alvorlighetsgrad:
   SELECT dato, Alvorlighetsgrad, Personskade, Beskrivelse, BeskrivelseHendelse
   FROM ai_gold.vw_Fact_RUH
   WHERE Prosjekt LIKE '%Hemsil%'
   AND Alvorlighetsgrad IN ('Alvorlig', 'Svært alvorlig')
   ORDER BY dato DESC
${STATIC_APPENDIX}`;

// ── Dynamisk prompt-bygging fra metadata-katalogen ──
// Cache per område-nøkkel ('all' = alle views, 'HMS' = kun HMS-views, osv.)
const promptCacheMap = new Map<string, { prompt: string; expires: number }>();

const escStr = (val: string): string => val.replace(/'/g, "''");

function rankViews(
  views: Record<string, unknown>[],
  kolonner: Record<string, unknown>[],
  spørsmål: string,
): Record<string, unknown>[] {
  if (!spørsmål) return views;
  const ord = spørsmål.toLowerCase().split(/\s+/).filter(o => o.length > 2);
  if (ord.length === 0) return views;

  return [...views]
    .map(v => {
      const viewTekst = [v['visningsnavn'], v['beskrivelse'], v['område']]
        .filter(Boolean).join(' ').toLowerCase();
      const viewKolonner = kolonner.filter(k => k['view_id'] === v['id']);
      const kolonneTekst = viewKolonner
        .map(k => [k['kolonne_navn'], k['beskrivelse']].filter(Boolean).join(' '))
        .join(' ').toLowerCase();
      const score = ord.reduce((sum, o) => sum + ((viewTekst + ' ' + kolonneTekst).includes(o) ? 1 : 0), 0);
      return { view: v, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.view);
}

async function buildDynamicViewsSection(
  viewIds?: string[] | null,
  område?: string | null,
  brukerSpørsmål?: string,
  kobletViewIds?: string[] | null,
): Promise<string> {
  // Filtrer views: direkte kobling → område → alle
  let viewsFilter: string;
  if (viewIds && viewIds.length > 0) {
    const idList = viewIds.map(id => `'${escStr(id)}'`).join(', ');
    viewsFilter = `WHERE v.er_aktiv = 1 AND v.id IN (${idList})`;
  } else if (område) {
    viewsFilter = `WHERE v.er_aktiv = 1 AND (v.område = '${escStr(område)}' OR v.område IS NULL)`;
  } else {
    viewsFilter = `WHERE v.er_aktiv = 1`;
  }

  const [views, kolonner, regler, eksempler] = await Promise.all([
    queryAzureSQL(`
      SELECT v.id, v.schema_name, v.view_name, v.visningsnavn,
             v.beskrivelse, v.område, v.prosjekter
      FROM ai_metadata_views v
      ${viewsFilter}
      ORDER BY v.område, v.view_name
    `),
    queryAzureSQL(`
      SELECT k.view_id, k.kolonne_navn, k.kolonne_type, k.datatype,
             k.beskrivelse, k.eksempel_verdier, k.lenketekst
      FROM ai_metadata_kolonner k
      JOIN ai_metadata_views v ON k.view_id = v.id
      ${viewsFilter}
      ORDER BY k.view_id, k.sort_order
    `),
    queryAzureSQL(`
      SELECT r.view_id, r.regel
      FROM ai_metadata_regler r
      JOIN ai_metadata_views v ON r.view_id = v.id
      ${viewsFilter}
    `),
    queryAzureSQL(`
      SELECT e.view_id, e.spørsmål, e.sql_eksempel
      FROM ai_metadata_eksempler e
      JOIN ai_metadata_views v ON e.view_id = v.id
      ${viewsFilter}
    `),
  ]);

  console.log(`[Chat] views fra metadata (område=${område ?? 'alle'}):`, views.map(v => v['view_name']));
  console.log('[buildSystemPrompt] views funnet:', views.length);
  const regnskapsView = views.find(v => String(v['view_name'] ?? '').includes('Regnskaps'));
  if (regnskapsView) {
    const regnskapsKolonner = kolonner.filter(k => k['view_id'] === regnskapsView['id']);
    console.log('[buildSystemPrompt] Regnskaps kolonner:', regnskapsKolonner.map(k => k['kolonne_navn']));
  }
  const kolonnerMedBeskrivelse = kolonner.filter(k => k['beskrivelse']);
  console.log(`[Chat] kolonner med beskrivelse: ${kolonnerMedBeskrivelse.length}`,
    kolonnerMedBeskrivelse.map(k => `${k['kolonne_navn']} (view_id=${k['view_id']})`));

  if (views.length === 0) throw new Error('Ingen aktive views funnet for dette området');

  // Ranger og begrens views basert på brukerens spørsmål
  const alleViews = views as Record<string, unknown>[];
  let viewsForPrompt: Record<string, unknown>[];
  let utelatte: string[] = [];

  if (brukerSpørsmål && alleViews.length > 4) {
    const rangerteViews = rankViews(alleViews, kolonner as Record<string, unknown>[], brukerSpørsmål);

    // Rapport-koblede views prioriteres alltid
    const koblede = kobletViewIds
      ? rangerteViews.filter(v => kobletViewIds.includes(v['id'] as string))
      : [];
    const andreRangerte = rangerteViews
      .filter(v => !kobletViewIds?.includes(v['id'] as string))
      .slice(0, 3);

    viewsForPrompt = [...koblede, ...andreRangerte];
    utelatte = alleViews
      .filter(v => !viewsForPrompt.includes(v))
      .map(v => v['visningsnavn'] as string);

    console.log('[buildSystemPrompt] views sendt til AI:', viewsForPrompt.map(v => v['view_name']));
    console.log('[buildSystemPrompt] utelatte views:', utelatte);
  } else {
    viewsForPrompt = alleViews;
  }

  // Bygg den fremtredende instruksjonsblokken FØRST — plassert øverst i prompten
  // slik at GPT-4o gir den høyest vekt
  const alleKolonnerMedBeskrivelse = kolonner.filter(k => k['beskrivelse']);
  let instruksjonsseksjon = '';
  if (alleKolonnerMedBeskrivelse.length > 0) {
    instruksjonsseksjon += 'VIKTIGE KOLONNE-INSTRUKSJONER (MÅ FØLGES):\n';
    instruksjonsseksjon += 'Disse instruksjonene er definert av dataeierne og er bindende.\n\n';
    for (const k of alleKolonnerMedBeskrivelse) {
      instruksjonsseksjon += `KOLONNE: ${k['kolonne_navn']}\n`;
      if (k['kolonne_type']) instruksjonsseksjon += `TYPE: ${k['kolonne_type']}\n`;
      instruksjonsseksjon += `INSTRUKSJON: ${k['beskrivelse']}\n`;
      instruksjonsseksjon += '---\n';
    }
    instruksjonsseksjon += '\n';
    console.log(`[Chat] kolonne-instruksjoner inkludert: ${alleKolonnerMedBeskrivelse.length} kolonner`);
    console.log('[Chat] kolonne-instruksjons-tekst (første 600 tegn):', instruksjonsseksjon.slice(0, 600));
  } else {
    console.log('[Chat] ingen kolonne-instruksjoner funnet');
  }

  let viewsPrompt = instruksjonsseksjon + 'TILGJENGELIGE VIEWS:\n\n';

  for (const view of viewsForPrompt) {
    viewsPrompt += `### ${view['schema_name']}.${view['view_name']}\n`;
    viewsPrompt += `Navn: ${view['visningsnavn']}\n`;
    if (view['område']) viewsPrompt += `Område: ${view['område']}\n`;
    if (view['beskrivelse']) viewsPrompt += `Beskrivelse: ${view['beskrivelse']}\n`;

    const viewKolonner = kolonner.filter(k => k['view_id'] === view['id']);
    if (viewKolonner.length > 0) {
      viewsPrompt += `Kolonner:\n`;
      const kolonneTekstLinjer: string[] = [];
      for (const k of viewKolonner) {
        const type = k['kolonne_type'] ? ` [${k['kolonne_type']}]` : '';
        let linje = `  - ${k['kolonne_navn']} (${k['datatype'] ?? 'ukjent'}${type})`;
        if (k['beskrivelse']) linje += ` — ${k['beskrivelse']}`;
        if (k['eksempel_verdier']) linje += ` (eks: ${k['eksempel_verdier']})`;
        kolonneTekstLinjer.push(linje);
      }
      const kolonneTekst = kolonneTekstLinjer.join('\n');
      viewsPrompt += kolonneTekst + '\n';
      if (String(view['view_name'] ?? '').includes('Regnskaps')) {
        console.log('[prompt] Regnskaps kolonner i prompt:', kolonneTekst.slice(0, 500));
      }
    }

    const viewRegler = regler.filter(r => r['view_id'] === view['id']);
    if (viewRegler.length > 0) {
      viewsPrompt += `Regler:\n`;
      for (const r of viewRegler) {
        viewsPrompt += `  - ${r['regel']}\n`;
      }
    }

    const viewEksempler = eksempler.filter(e => e['view_id'] === view['id']);
    if (viewEksempler.length > 0) {
      viewsPrompt += `Eksempelspørringer:\n`;
      for (const e of viewEksempler) {
        if (e['spørsmål']) viewsPrompt += `  -- ${e['spørsmål']}\n`;
        if (e['sql_eksempel']) viewsPrompt += `  ${e['sql_eksempel']}\n`;
      }
    }

    viewsPrompt += '\n';
  }

  // Andre tilgjengelige views (ikke inkludert i prompt)
  if (utelatte.length > 0) {
    viewsPrompt += `\nAndre tilgjengelige datakilder (spør meg hvis relevant): ${utelatte.join(', ')}\n`;
  }

  // Oppklarende spørsmål ved mange views
  const viewInstruks = viewsForPrompt.length > 3
    ? `\nNår bruker spør om data som kan ligge i flere views, still ett oppklarende spørsmål:\n"Dette kan jeg finne i [view A] (beskrivelse) eller [view B] (beskrivelse). Hvilken vil du sjekke?"\nSøk deretter i riktig view basert på svaret.\n`
    : '';
  viewsPrompt += viewInstruks;

  // Legg til instruksjoner for URL-kolonner
  const urlKolonner = kolonner.filter(k => k['kolonne_type'] === 'url');
  if (urlKolonner.length > 0) {
    viewsPrompt += 'URL-KOLONNER (VIKTIG):\n';
    viewsPrompt += 'Følgende kolonner inneholder URL-er. Vis dem ALLTID som klikkbare markdown-lenker, aldri som rå URL-streng.\n';
    for (const k of urlKolonner) {
      const lenketekst = k['lenketekst'] || k['kolonne_navn'];
      viewsPrompt += `  - ${k['kolonne_navn']}: vis som [${lenketekst}](url-verdien)\n`;
    }
    viewsPrompt += '\n';
  }

  return viewsPrompt;
}

async function buildSystemPrompt(
  rapportId?: string | null,
  område?: string | null,
  brukerSpørsmål?: string,
): Promise<string> {
  // Prøv rapport-spesifikk kobling først
  let kobletViewIds: string[] | null = null;
  if (rapportId) {
    try {
      const kobling = await queryAzureSQL(`
        SELECT view_id FROM ai_rapport_view_kobling
        WHERE rapport_id = '${escStr(rapportId)}'
        ORDER BY prioritet
      `);
      if (kobling.length > 0) {
        kobletViewIds = kobling.map(r => r['view_id'] as string);
        console.log(`[Chat] bruker ${kobletViewIds.length} koblede views for rapport ${rapportId}`);
      }
    } catch {
      // Tabell finnes ikke ennå — fallback til område-filter
    }
  }

  console.log('[buildSystemPrompt] kobletViewIds:', kobletViewIds);

  // Når brukerSpørsmål er satt bruker vi dynamisk ranking — hopp over cache
  const cacheKey = brukerSpørsmål ? null : (kobletViewIds ? `rapport:${rapportId}` : (område ?? 'all'));
  if (cacheKey) {
    const cached = promptCacheMap.get(cacheKey);
    if (cached && Date.now() < cached.expires) return cached.prompt;
  }

  try {
    const dynamicSection = await buildDynamicViewsSection(
      kobletViewIds,
      kobletViewIds ? null : område,
      brukerSpørsmål,
      kobletViewIds,
    );
    const prompt = PROSJEKT_INSTRUKSJON + dynamicSection + STATIC_APPENDIX;
    if (cacheKey) {
      promptCacheMap.set(cacheKey, { prompt, expires: Date.now() + 2 * 60 * 1000 });
    }
    return prompt;
  } catch (err) {
    console.warn('[Chat] Bruker fallback til hardkodet prompt:', err instanceof Error ? err.message : err);
    return FALLBACK_BASIS_PROMPT;
  }
}

interface ChatBody {
  messages: ChatMessage[];
  rapportId?: string;
  pbiReportId?: string;
  rapportNavn?: string;
  slicers?: string[];
  slicerValues?: Record<string, Record<string, string[]>>;
  activeSlicerState?: Record<string, unknown>;
  aktivSide?: string;
  visualData?: Record<string, string>;
  kanLageRapport?: boolean;
  grupper?: string[];
}

/**
 * Renser conversation history slik at OpenAI aldri mottar ufullstendige tool-sekvenser.
 *
 * To-pass tilnærming for å fange alle edge cases:
 * - Pass 1: Dropp tool-meldinger uten forutgående assistant+tool_calls (orphans)
 * - Pass 2: Dropp assistant+tool_calls uten etterfølgende tool-svar
 */
function rensConversationHistory(messages: ChatMessage[]): ChatMessage[] {
  if (!messages?.length) return [];

  // PASS 1: Fjern tool-meldinger uten en assistant+tool_calls rett foran (i akkumulert array)
  const pass1: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'tool') {
      const forrige = pass1[pass1.length - 1];
      if (forrige?.role === 'assistant' && (forrige.tool_calls?.length ?? 0) > 0) {
        pass1.push(msg);
      }
      // Dropp orphan tool-melding
    } else {
      pass1.push(msg);
    }
  }

  // PASS 2: Fjern assistant+tool_calls uten etterfølgende tool-svar
  const pass2: ChatMessage[] = [];
  for (let i = 0; i < pass1.length; i++) {
    const msg = pass1[i];
    if (msg.role === 'assistant' && (msg.tool_calls?.length ?? 0) > 0) {
      const neste = pass1[i + 1];
      if (neste?.role === 'tool') {
        pass2.push(msg);
      }
      // Dropp assistant+tool_calls uten tool-svar
    } else {
      pass2.push(msg);
    }
  }

  return pass2;
}

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: ChatBody }>(
    '/api/chat',
    {
      preHandler: [resolveTenant],
      schema: {
        body: {
          type: 'object',
          required: ['messages'],
          properties: {
            messages:    { type: 'array' },
            rapportId:   { type: 'string' },
            pbiReportId: { type: 'string' },
            rapportNavn: { type: 'string' },
            slicers:      { type: 'array', items: { type: 'string' } },
            slicerValues:      { type: 'object', additionalProperties: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } } },
            activeSlicerState: { type: 'object' },
            aktivSide:         { type: 'string' },
            visualData:        { type: 'object', additionalProperties: { type: 'string' } },
            kanLageRapport:    { type: 'boolean' },
            grupper:           { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { messages: rawMessages, rapportId, pbiReportId, slicers, slicerValues, activeSlicerState, aktivSide } = request.body;

      // Logg mottatt history
      console.log('[Chat] history mottatt:', rawMessages?.map((m) => ({
        role: m.role,
        innhold: (m.content as string | null)?.substring(0, 50),
      })));

      // Rens ufullstendige tool-sekvenser — to pass + slice(-10) + andre pass etter slice
      let messages: ChatMessage[] = [];
      try {
        const renset   = rensConversationHistory(rawMessages ?? []);
        const begrenset = renset.slice(-10);
        // Andre pass: slice kan ha kuttet midt i en sekvens — rens igjen
        messages = rensConversationHistory(begrenset);
      } catch (err) {
        console.error('[Chat] history rensing feil:', err);
        // Fallback: tom history (kun system prompt)
        messages = [];
      }

      console.log('[Chat] history roller:', messages.map((m) => m.role));
      console.log('[Chat] history etter rensing:', messages.map((m) => ({
        role: m.role,
        harToolCalls: !!(m.tool_calls?.length),
        toolCallId: m.tool_call_id,
      })));

      // Bygg chat-kontekst (brukes av search_portal_reports og create_report)
      const entraObjectId = (request.headers['x-entra-object-id'] as string | undefined)?.trim();
      let chatContext: ChatContext = { entraObjectId };
      if (entraObjectId) {
        try {
          const bruker = await prisma.bruker.findUnique({ where: { entraObjectId }, select: { rolle: true } });
          const kanLageRapport = erAdmin(bruker?.rolle) || bruker?.rolle === 'redaktør';
          chatContext = { entraObjectId, isAdmin: erAdmin(bruker?.rolle), kanLageRapport };
        } catch {
          // ignorerer feil, fortsetter uten admin-flagg
        }
      }

      console.log('[Chat] mottatt:', {
        rapportId:       request.body.rapportId,
        pbiReportId:     request.body.pbiReportId,
        rapportNavn:     request.body.rapportNavn,
        aktivSide:       request.body.aktivSide,
        antallMeldinger: request.body.messages?.length,
      });
      // STEG 5: Logg aktiv rapportside
      console.log('[Chat] aktiv rapportside:', aktivSide ?? '(ingen)');

      // Ingen rapport valgt — vis alle views
      if (!pbiReportId) {
        console.log('[Chat] prosjektNr:', 'ingen (forside)');
        console.log('[Chat] kontekst:', 'global');
        const sisteBrukermelding = [...(request.body.messages ?? [])].reverse().find(m => m.role === 'user')?.content ?? '';
        const basisPrompt = await buildSystemPrompt(null, null, sisteBrukermelding as string);
        // FIX 4: token-estimat (ingen-rapport branch)
        console.log('[Chat] ingen-rapport prompt lengde (tegn):', basisPrompt.length);
        console.log('[Chat] ingen-rapport estimert tokens:', Math.round(basisPrompt.length / 4));

        // Bygg rapport-liste basert på brukerens workspace-tilgang
        let rapportListeSection = '';
        if (entraObjectId) {
          try {
            const db = (request as TenantRequest).tenantPrisma;
            const grupper: string[] = request.body.grupper ?? [];
            const identities = [entraObjectId, ...grupper].filter(Boolean);
            console.log('[Chat] rapport-liste | entraId:', entraObjectId,
              '| grupper:', grupper.length, '| identities:', identities.length);
            const orFilter = [];
            if (identities.length > 0) {
              orFilter.push({ tilgang: { some: { entraId: { in: identities } } } });
            }
            // Inkluder workspaces brukeren har opprettet (lokal bruker / personlig workspace)
            orFilter.push({ opprettetAv: entraObjectId });
            const tilgjengeligeWorkspaces = await db.workspace.findMany({
              where: { OR: orFilter },
              select: {
                navn: true,
                rapporter: {
                  where: { rapport: { erAktiv: true } },
                  select: {
                    rapport: { select: { id: true, navn: true, område: true, beskrivelse: true } },
                  },
                },
              },
              take: 30,
            });
            const rapporter = tilgjengeligeWorkspaces.flatMap(ws =>
              ws.rapporter.map(wr => ({ ...wr.rapport, workspace_navn: ws.navn }))
            );
            console.log('[Chat] tilgjengeligeWorkspaces:', tilgjengeligeWorkspaces.length);
            if (rapporter.length > 0) {
              rapportListeSection = '\n\n## Tilgjengelige rapporter\n' +
                'Du kan hjelpe brukeren med å finne og navigere til disse:\n\n' +
                rapporter.map((r, i) => {
                  const kontekst = [r.område, r.workspace_navn].filter(Boolean).join(' · ');
                  return `${i + 1}. **${r.navn}** — ${kontekst} [rapport_id:${r.id}]` +
                    (r.beskrivelse ? `\n   ${r.beskrivelse}` : '');
                }).join('\n');
              console.log(`[Chat] rapport-liste: ${rapporter.length} rapporter for bruker`);
            } else {
              console.log('[Chat] rapport-liste: ingen rapporter funnet');
            }
          } catch (err) {
            console.warn('[Chat] rapport-liste feil:', err);
          }
        }
        let ingenRapportPrompt = `Du er en dataassistent for LNS Dataportal.
Ingen rapport er valgt.

AKTIV KONTEKST:
Ingen rapport er åpen. Du har tilgang til data på tvers av alle prosjekter.

Når du henter data uten prosjektfilter, grupper alltid på prosjekt i resultatet:
GROUP BY Prosjektnr ORDER BY Prosjektnr

Tilgjengelige prosjekter i systemet:
SELECT DISTINCT Prosjektnr, Prosjektnavn FROM ai_gold.vw_Fact_Bolting_BeverBas

RAPPORTSØK — VIKTIGE REGLER:
- Bruk ALLTID search_portal_reports når brukeren spør om rapporter eller vil åpne en rapport
- Aldri bruk query_database for å søke etter rapporter
- For å liste alle: kall search_portal_reports med sokeord=""
- For å søke: kall search_portal_reports med relevante søkeord

Etter søk: presenter resultatene NØYAKTIG med nummeret fra "nr"-feltet i tool-resultatet. Ta med [rapport_id:UUID] — skjult metadata som filtreres bort før bruker ser det:

{nr}. **{navn}** ({område}) — {workspace_navn} [rapport_id:{id}]
   {beskrivelse}

Eksempel:
1. **KPI 6050** (Produksjon) — Prosjekt 6050 [rapport_id:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx]
   KPI-rapport for prosjekt 6050

2. **Maskinliste EU kontroll** (Maskin) — Innkjøp [rapport_id:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa]
   Maskiner klargjort for EU kontroll

3. **Maskinliste EU kontroll** (Maskin) — Prosjekt 6050 [rapport_id:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb]
   Maskiner klargjort for EU kontroll

- KRITISK: nummeret i listen MÅ samsvare med "nr"-feltet fra tool-resultatet
- [rapport_id:...] MÅ alltid være med — filtreres automatisk, vises aldri til bruker
- Spør hvilken rapport brukeren vil åpne (oppgi nummer)

ÅPNE RAPPORT — KRITISK:
- Når brukeren sier "ja", "åpne", "nr X", "den første", "nr 2" e.l. etter en rapportliste:
  → Se i DIN FORRIGE melding i conversation history — der er [rapport_id:UUID] på slutten av hver linje
  → Bruker sier "nr X" → finn linjen som STARTER med "X." og ekstraher UUID fra [rapport_id:UUID]
  → Kall open_report direkte med denne UUID-en
  → IKKE kall search_portal_reports på nytt — IDene finnes allerede i forrige svar
  → id er ALLTID en UUID på formen xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  → ALDRI bruk rapportnavnet, en slug eller konstruert ID som rapportId
${basisPrompt}${rapportListeSection}

Svar alltid på norsk.`;

        if (chatContext.kanLageRapport) {
          ingenRapportPrompt += `\n\nLAG RAPPORT — TILGJENGELIG FOR DIN ROLLE:
Du er Admin/Redaktør og kan opprette nye datarapporter basert på SQL-views i ai_gold-skjemaet.
Når brukeren ber om å "lage", "opprette" eller "bygge" en ny rapport:
1. Avklar tema/innhold om det er uklart
2. Velg riktig ai_gold-view og bygg en passende SQL-spørring med aggregering/gruppering
3. Kall create_report med tittel, sql, visualType, og valgfritt xAkse/yAkse/grupperPaa
4. Rapporten vises direkte i portalen med chart og tabell

Tilgjengelige visualiseringstyper:
- bar — søylediagram (sammenligning per kategori)
- line — linjediagram (tidsserier/trender)
- table — tabell (detaljdata)
- pie — kakediagram (andeler/prosent)
- card — KPI-kort (enkeltverdi/nøkkeltall)`;
        }

        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');
        reply.raw.setHeader('Access-Control-Allow-Origin', '*');
        reply.hijack();

        const write = (chunk: unknown) => {
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        };

        try {
          await chat(messages, ingenRapportPrompt, write, chatContext);
        } catch (err) {
          write({ type: 'error', message: err instanceof Error ? err.message : 'Ukjent feil' });
        } finally {
          reply.raw.end();
        }
        return;
      }

      // ── Hent rapport-kontekst: Prisma-tabell (primær) → vw_Chat_ReportCatalog (fallback) ──
      let rapportNavn  = request.body.rapportNavn ?? 'ukjent';
      let rapportOmråde: string | null = null;
      let rapportBeskrivelse: string | null = null;
      let rapportNøkkelord: string | null = null;
      let prosjektNr: string | null = null;
      let workspaceNavn: string | null = null;

      try {
        const db = (request as TenantRequest).tenantPrisma;
        const rapport = rapportId
          ? await db.rapport.findUnique({
              where: { id: rapportId },
              select: {
                område: true, beskrivelse: true, nøkkelord: true,
                pbiDatasetId: true, pbiWorkspaceId: true, pbiReportId: true,
                workspaces: { select: { workspace: { select: { navn: true } } }, take: 1 },
              },
            })
          : null;

        if (rapport) {
          rapportOmråde      = rapport.område;
          rapportBeskrivelse = rapport.beskrivelse;
          rapportNøkkelord   = rapport.nøkkelord;
          workspaceNavn      = rapport.workspaces?.[0]?.workspace?.navn ?? null;
          prosjektNr         = workspaceNavn?.match(/\b(\d{4,5})\b/)?.[1] ?? null;
          // Berik chatContext med PBI-IDs og prosjektkontekst for create_report
          chatContext = {
            ...chatContext,
            pbiDatasetId:    rapport.pbiDatasetId  ?? undefined,
            pbiWorkspaceId:  rapport.pbiWorkspaceId ?? undefined,
            kildePbiReportId: rapport.pbiReportId   ?? undefined,
            prosjektNr,
            prosjektNavn:    workspaceNavn,
          };
          console.log('[Chat] rapport område (Prisma):', rapportOmråde);
          console.log('[Chat] prosjektNr:', prosjektNr ?? 'ingen');
          console.log('[Chat] kontekst:', prosjektNr ? 'rapport' : 'global');
        } else {
          // Fallback: vw_Chat_ReportCatalog
          const rows = await queryAzureSQL(`
            SELECT DISTINCT SubjectArea, BusinessDescription, Keywords
            FROM ai_gold.vw_Chat_ReportCatalog
            WHERE ReportId = '${pbiReportId}'
          `, 1);
          const rc = rows[0];
          if (rc) {
            rapportOmråde      = (rc['SubjectArea'] as string) ?? null;
            rapportBeskrivelse = (rc['BusinessDescription'] as string) ?? null;
            rapportNøkkelord   = (rc['Keywords'] as string) ?? null;
            console.log('[Chat] rapport område (ReportCatalog):', rapportOmråde);
          }
        }
      } catch (err) {
        console.warn('[Chat] Rapport-kontekst feil:', err instanceof Error ? err.message : err);
      }

      // Bygg system prompt — prøv rapport-kobling, fallback til område, fallback til alle
      const sisteBrukermelding = [...(request.body.messages ?? [])].reverse().find(m => m.role === 'user')?.content ?? '';
      const basisPrompt = await buildSystemPrompt(rapportId, rapportOmråde, sisteBrukermelding as string);

      // FIX 1: Begrens slicer-verdier til maks 20 verdier per år/gruppe for å spare tokens
      const slicerValuesSummary = slicerValues
        ? Object.fromEntries(
            Object.entries(slicerValues).map(([slicer, years]) => [
              slicer,
              Object.fromEntries(
                Object.entries(years as Record<string, string[]>).map(([yr, vals]) => [yr, vals.slice(0, 20)])
              ),
            ])
          )
        : null;

      const aktivKontekst = prosjektNr
        ? `
AKTIV KONTEKST:
Rapport: ${rapportNavn}
Prosjekt: ${prosjektNr}${workspaceNavn ? ` (${workspaceNavn})` : ''}${rapportOmråde ? `\nOmråde: ${rapportOmråde}` : ''}

Filtrer ALLTID på prosjekt ${prosjektNr} med mindre bruker eksplisitt ber om data på tvers av prosjekter.
Produksjon: WHERE Prosjektnr = ${prosjektNr}
RUH: WHERE ProsjektId = '${prosjektNr}' OR WHERE Prosjekt LIKE '%${prosjektNr}%'
`
        : '';

      let rapportKontekst = `Du er en dataassistent for LNS Dataportal.

RAPPORT KONTEKST:
Navn: ${rapportNavn}${rapportOmråde ? `\nFagområde: ${rapportOmråde}` : ''}${rapportBeskrivelse ? `\nBeskrivelse: ${rapportBeskrivelse}` : ''}${rapportNøkkelord ? `\nNøkkelord: ${rapportNøkkelord}` : ''}${aktivSide ? `\nAktiv side: ${aktivSide}` : ''}
${aktivKontekst}${aktivSide ? `Bruker ser på rapportsiden: "${aktivSide}"\nTilpass svar og forslag til denne siden.\n` : ''}${basisPrompt}

AKTIVE SLICER-VALG I RAPPORTEN:
${activeSlicerState && Object.keys(activeSlicerState).length > 0
  ? Object.entries(activeSlicerState)
      .filter(([, v]) => v !== null && !(Array.isArray(v) && (v as unknown[]).length === 0))
      .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
      .join('\n') || '(ingen aktive filtre)'
  : '(ingen aktive filtre)'}

Når du henter data fra database, filtrer ALLTID på de aktive slicer-verdiene med mindre bruker eksplisitt ber om data på tvers.
Eksempel: Slicer "Stuff" = "AKs - Adkomst kraftstasjon" → legg til WHERE Profilnavn = 'AKs - Adkomst kraftstasjon' (eller tilsvarende kolonnenavn for det aktuelle viewet).
Match slicer-nøkkelen mot kolonnenavn i viewet — bruk LIKE '%verdi%' om eksakt match er usikker.

SLICER-REGLER:
- Tilgjengelige slicers: ${slicers?.join(', ') ?? '(ingen)'}
- Gyldige slicer-verdier (maks 20 per gruppe): ${slicerValuesSummary && Object.keys(slicerValuesSummary).length > 0 ? JSON.stringify(slicerValuesSummary) : '(ikke lastet ennå)'}
- Aktivt slicer-state (JSON): ${activeSlicerState && Object.keys(activeSlicerState).length > 0 ? JSON.stringify(activeSlicerState) : '(ingen aktive filtre)'}

VIKTIG - I denne applikasjonen finnes det IKKE rapportfiltre.
Når brukeren sier "filter", "filtrer", "sett filter", "fjern filter", "ta bort filter" e.l. betyr det alltid SLICER.
- For å sette slicer: bruk set_report_slicer
- For å fjerne/nullstille slicer: bruk clear_report_slicer

REGLER FOR Å SETTE SLICER:
1. Les gyldige verdier fra slicer-verdier over for aktuell slicer
2. Match brukerens forespørsel mot verdilisten
3. Bruk EKSAKT verdi fra listen - aldri lag egne verdier
4. Hvis du finner én match: sett sliceren direkte
5. Hvis du finner flere mulige treff: spør brukeren hvilken
6. Hvis ingen match: si ifra og list tilgjengelige verdier

SPESIELT FOR TID-SLICER (hierarchy):
- Verdier er gruppert per år: { "2025": [...], "2026": [...] }
- Format: "9 (23.02.26-01.03.26)"
- Match "uke 9" → finn verdien som starter med "9 "
- Bruk set_report_slicer med slicerTitle, values og år

DATAHENTING - KRITISKE REGLER:
- Når brukeren spør om data: ALLTID kall query_database umiddelbart. Ikke spør om du skal gjøre det.
- Ikke si at du ikke har tilgang til data. Du har ALLTID tilgang via query_database.
- Ikke avvis spørsmål fordi data ikke finnes i rapporten — søk i databasen først.

PRIORITERING FOR PRODUKSJONSRAPPORTER:
1. Velg riktig view basert på spørsmålet
2. Bygg SQL og kall query_database
3. Presenter resultatet

For å se hvilke rapporter som finnes eller åpne en annen rapport:
- Bruk ALLTID search_portal_reports — aldri query_database for rapportsøk
- search_portal_reports returnerer: nr, id (portal-UUID), navn, område, beskrivelse, workspace_navn
- For å liste alle: sokeord="", for å søke: bruk relevante søkeord
- Presenter NØYAKTIG med nummeret fra "nr"-feltet i tool-resultatet:

  {nr}. **{navn}** ({område}) — {workspace_navn} [rapport_id:{id}]
     {beskrivelse}

- KRITISK: nummeret i listen MÅ samsvare med "nr"-feltet fra tool-resultatet
- [rapport_id:...] MÅ alltid være med — filtreres automatisk, vises aldri til bruker
- Spør brukeren hvilken rapport de vil åpne (oppgi nummer)

ÅPNE RAPPORT — KRITISK:
- Når brukeren sier "ja", "åpne", "nr X", "den første", "nr 2" e.l. etter en rapportliste:
  → Se i DIN FORRIGE melding i conversation history — der er [rapport_id:UUID] på slutten av hver linje
  → Bruker sier "nr X" → finn linjen som STARTER med "X." og ekstraher UUID fra [rapport_id:UUID]
  → Kall open_report direkte med denne UUID-en
  → IKKE kall search_portal_reports på nytt — IDene finnes allerede i forrige svar
  → id er ALLTID en UUID på formen xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
- ALDRI bruk rapportnavnet, en slug eller konstruert ID som rapportId
- ALDRI bruk pbiReportId — bruk kun id-feltet fra search_portal_reports
- id skal ALDRI vises til brukeren, kun brukes internt i open_report-kallet

REGLER:
- Svar alltid på norsk
- For data-spørsmål: kall query_database automatisk uten å spørre brukeren
- Når du presenterer data fra en spørring, ikke legg til oppfordring om nedlasting — det finnes en knapp i grensesnittet

Svar alltid på norsk. Vær konkret.`;

      // Legg til create_report-instruksjoner for admin/redaktør
      if (chatContext.kanLageRapport) {
        rapportKontekst += `\n\nLAG RAPPORT — TILGJENGELIG FOR DIN ROLLE:
Du er Admin/Redaktør og kan opprette nye datarapporter basert på SQL-views i ai_gold-skjemaet.
Når brukeren ber om å "lage", "opprette" eller "bygge" en ny rapport:
1. Avklar tema/innhold om det er uklart
2. Velg riktig ai_gold-view og bygg en passende SQL-spørring med aggregering/gruppering
3. Kall create_report med tittel, sql, visualType, og valgfritt xAkse/yAkse/grupperPaa
4. Rapporten vises direkte i portalen med chart og tabell

Tilgjengelige visualiseringstyper:
- bar — søylediagram (sammenligning per kategori)
- line — linjediagram (tidsserier/trender)
- table — tabell (detaljdata)
- pie — kakediagram (andeler/prosent)
- card — KPI-kort (enkeltverdi/nøkkeltall)

VIKTIG — PROSJEKTFILTER I SQL:
Rapporten er allerede koblet til et prosjekt via et låst filter (prosjektNr = ${prosjektNr ?? 'ikke satt'}).
Bruk ALLTID Prosjektnr (heltall) som prosjektfilter — ALDRI Prosjektnavn (tekst).
Riktig: WHERE Prosjektnr = ${prosjektNr ?? '<prosjektnr>'}
FEIL: WHERE Prosjektnavn = ${prosjektNr ?? '<prosjektnr>'} eller WHERE Prosjektnavn LIKE '%...%'
Prosjektfilteret er obligatorisk i SQL og skal IKKE vises som brukerfilter i rapporten.`;
      }

      // Logg token-estimat og verifiser kolonne-instruksjoner
      console.log('[Chat] system prompt lengde (tegn):', rapportKontekst.length);
      console.log('[Chat] estimert tokens:', Math.round(rapportKontekst.length / 4));
      console.log('[Chat] antall meldinger i history:', messages.length);
      const harKolonneInstruksjoner = rapportKontekst.includes('VIKTIGE KOLONNE-INSTRUKSJONER');
      console.log('[Chat] kolonne-instruksjoner i prompt:', harKolonneInstruksjoner ? 'INKLUDERT' : 'MANGLER');
      if (harKolonneInstruksjoner) {
        const start = rapportKontekst.indexOf('VIKTIGE KOLONNE-INSTRUKSJONER');
        console.log('[Chat] kolonne-seksjon (første 400 tegn):', rapportKontekst.slice(start, start + 400));
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.setHeader('Access-Control-Allow-Origin', '*');
      reply.hijack();

      const write = (chunk: unknown) => {
        console.log('[Chat] sender SSE event:', chunk);
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      };

      try {
        await chat(messages, rapportKontekst, write, chatContext);
      } catch (err) {
        console.error('[chat] feil:', err);
        write({ type: 'error', message: err instanceof Error ? err.message : 'Ukjent feil' });
      } finally {
        reply.raw.end();
      }
    },
  );
}
