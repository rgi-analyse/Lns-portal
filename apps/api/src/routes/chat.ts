import type { FastifyInstance } from 'fastify';
import { chat, type ChatMessage, type ChatContext } from '../services/openaiService';
import { queryAzureSQL } from '../services/azureSqlService';
import { prisma } from '../lib/prisma';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';
import { erAdmin } from '../middleware/auth';

// ── Statisk del av system-prompten ──
const SYSTEM_INTRO = `Du er en dataassistent som hjelper brukere med å hente og analysere data fra virksomhetens databaser.`;

const SQL_REGLER = `## SQL-regler (Azure T-SQL)
- Bruk TOP 20 for å begrense rader i rådata-lister — ALDRI LIMIT
- Aldri bruk TOP på spørringer med GROUP BY
- Bruk GETDATE() ikke NOW()
- Bruk ISNULL() eller COALESCE() — ikke IFNULL()
- Datoformat: CONVERT(VARCHAR, dato, 103) for DD/MM/YYYY
- Paginering: SELECT * FROM tabell ORDER BY kolonne OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY
- Kall query_database umiddelbart når bruker spør om data — ikke spør om du skal gjøre det
- Svar alltid på norsk

KOLONNE-TYPE REGLER:
- Sjekk alltid datatype fra kolonneinfo i systemprompten før du skriver SQL
- varchar/nvarchar-kolonner skal ALDRI castes til tall
- Bruk alltid LIKE for søk på varchar-kolonner:
  ✅ WHERE kolonne LIKE '%søkeverdi%'
  ❌ WHERE CAST(kolonne AS INT) = verdi
  ❌ WHERE ISNUMERIC(kolonne) = 1
  ❌ WHERE TRY_CAST(kolonne AS INT) = verdi
- GROUP BY på varchar fungerer direkte — ingen casting nødvendig:
  ✅ SELECT kolonne, SUM(Beløp) FROM view GROUP BY kolonne
- Ved konverteringsfeil i SQL: ikke prøv CAST-varianter — bytt til LIKE-søk i stedet

DATO-RANGE REGLER:
Når bruker spør om data "frem til [måned år]", "t.o.m.", "opp til", "akkumulert til":
FEIL — henter kun én periode: WHERE År = 2026 AND Måned = 4
RIKTIG — henter alle perioder frem til og med: WHERE (År < 2026) OR (År = 2026 AND Måned <= 4)
Eksempel "sum alle år frem til april 2026":
  SELECT År, SUM(Beløp) AS Total FROM [view]
  WHERE (År < 2026) OR (År = 2026 AND Måned <= 4)
  GROUP BY År ORDER BY År
Eksempel "akkumulert sum t.o.m. april 2026":
  SELECT SUM(Beløp) AS TotalTomApril2026 FROM [view]
  WHERE (År < 2026) OR (År = 2026 AND Måned <= 4)`;

const SØKESTRATEGI_REGLER = `## Søkestrategi
- Les kolonnebeskrivelsene nøye — de forteller deg hva kolonnen inneholder og hvordan den brukes
- Foretrekk kategoriseringskolonner (Type, Gruppe, Kategori, Status) fremfor LIKE-søk på store tekstkolonner
- Informer alltid hvilken datakilde du bruker: "Jeg søker i **[Visningsnavn]** fordi..."
- Spør bruker ved tvil om hvilken datakilde som er riktig
- Ved tomt resultat: prøv én alternativ søkestrategi automatisk før du svarer at ingenting finnes
- Prosjekter kan refereres som tall ("1000"), navn ("Hemsil"), eller kombinasjon ("P1000" = 1000 — fjern prefiks "P")`;

// ── Fallback generisk prompt (brukes om metadata-tabeller ikke er tilgjengelige) ──
const FALLBACK_BASIS_PROMPT = `${SYSTEM_INTRO}

${SQL_REGLER}

${SØKESTRATEGI_REGLER}

## Tilgjengelige datakilder
Metadata-tabeller er ikke tilgjengelige for øyeblikket.
Spør brukeren om hvilken datakilde de vil søke i, og be dem oppgi view-navn eller tabell de vil bruke.`;

// ── Dynamisk prompt-bygging fra metadata-katalogen ──
// Cache per område-nøkkel ('all' = alle views, 'HMS' = kun HMS-views, osv.)
const promptCacheMap = new Map<string, { prompt: string; expires: number }>();

const escStr = (val: string): string => val.replace(/'/g, "''");

function rankViews(
  views: Record<string, unknown>[],
  kolonner: Record<string, unknown>[],
  regler: Record<string, unknown>[],
  spørsmål: string,
  profilViews?: string[],
): Record<string, unknown>[] {
  if (!spørsmål) return views;
  const s = spørsmål.toLowerCase();
  const ord = s.split(/\s+/).filter(o => o.length > 2);
  if (ord.length === 0) return views;

  const rangeringer = [...views].map(v => {
    const viewTekst = [v['visningsnavn'], v['beskrivelse'], v['område']]
      .filter(Boolean).join(' ').toLowerCase();
    const viewKolonner = kolonner.filter(k => k['view_id'] === v['id']);
    const kolonneTekst = viewKolonner
      .map(k => [k['kolonne_navn'], k['beskrivelse']].filter(Boolean).join(' '))
      .join(' ').toLowerCase();
    const regelTekst = regler
      .filter(r => r['view_id'] === v['id'])
      .map(r => r['regel'] ?? '').join(' ').toLowerCase();
    const allTekst = [viewTekst, kolonneTekst, regelTekst].join(' ');

    let score = ord.reduce((sum, o) => sum + (allTekst.includes(o) ? 1 : 0), 0);

    // Nøkkelord-boost fra metadata — ingen hardkoding
    const nøkkelordStr = String(v['nøkkelord'] ?? '');
    if (nøkkelordStr) {
      const nøkkelord = nøkkelordStr.toLowerCase().split(',').map(n => n.trim()).filter(Boolean);
      const treff = nøkkelord.filter(n => s.includes(n)).length;
      score += treff * 3;
    }

    // Profil-boost: views koblet til brukerens mest brukte rapporter
    if (profilViews?.includes(String(v['view_name'] ?? ''))) score += 2;

    return { view: v, score, view_name: v['view_name'] };
  });

  console.log('[rankViews] scores:', rangeringer.map(r => `${r.score} — ${r.view_name}`).join(', '));

  return rangeringer.sort((a, b) => b.score - a.score).map(x => x.view);
}

async function buildDynamicViewsSection(
  viewIds?: string[] | null,
  område?: string | null,
  brukerSpørsmål?: string,
  kobletViewIds?: string[] | null,
  tillatteViewIds?: string[] | null,
  profilViews?: string[],
): Promise<string> {
  // Filtrer views: rapport-kobling → workspace-tilgang → område → alle
  let viewsFilter: string;
  if (viewIds && viewIds.length > 0) {
    const idList = viewIds.map(id => `'${escStr(id)}'`).join(', ');
    viewsFilter = `WHERE v.er_aktiv = 1 AND v.id IN (${idList})`;
  } else if (tillatteViewIds && tillatteViewIds.length > 0) {
    const idList = tillatteViewIds.map(id => `'${escStr(id)}'`).join(', ');
    viewsFilter = `WHERE v.er_aktiv = 1 AND v.id IN (${idList})`;
  } else if (område) {
    viewsFilter = `WHERE v.er_aktiv = 1 AND (v.område = '${escStr(område)}' OR v.område IS NULL)`;
  } else {
    viewsFilter = `WHERE v.er_aktiv = 1`;
  }
  console.log('[buildSystemPrompt] viewsFilter:', viewsFilter);

  const [views, kolonner, regler, eksempler, kpi] = await Promise.all([
    queryAzureSQL(`
      SELECT v.id, v.schema_name, v.view_name, v.visningsnavn,
             v.beskrivelse, v.område, v.prosjekter, v.nøkkelord
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
    queryAzureSQL(`
      SELECT k.view_id, k.navn, k.visningsnavn, k.sql_uttrykk, k.format, k.beskrivelse
      FROM ai_metadata_kpi k
      JOIN ai_metadata_views v ON k.view_id = v.id
      ${viewsFilter}
      AND k.er_aktiv = 1
    `).catch(() => [] as Record<string, unknown>[]),
  ]);

  console.log(`[Chat] views fra metadata (område=${område ?? 'alle'}):`, views.map(v => v['view_name']));
  console.log('[buildSystemPrompt] regler fra SQL (første 3):', JSON.stringify(regler.slice(0, 3)));
  console.log('[buildSystemPrompt] antall regler totalt:', regler.length);
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
    const rangerteViews = rankViews(alleViews, kolonner as Record<string, unknown>[], regler as Record<string, unknown>[], brukerSpørsmål, profilViews);

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

    console.log('[buildSystemPrompt] sender til AI:', viewsForPrompt.map(v => v['view_name']).join(', '));
    console.log('[buildSystemPrompt] utelatte views:', utelatte.join(', '));
  } else {
    viewsForPrompt = alleViews;
  }

  // Bygg views-seksjon
  const viewsPrompt = viewsForPrompt.map(view => {
    const viewKolonner = kolonner.filter(k => k['view_id'] === view['id']);
    const kolonnerTekst = viewKolonner.map(k => {
      let linje = `   - ${k['kolonne_navn']}`;
      if (k['beskrivelse']) linje += ` — ${k['beskrivelse']}`;
      if (k['eksempel_verdier']) linje += ` (eks: ${k['eksempel_verdier']})`;
      return linje;
    }).join('\n');

    if (String(view['view_name'] ?? '').includes('Regnskaps')) {
      console.log('[prompt] Regnskaps kolonner i prompt:', kolonnerTekst.slice(0, 500));
    }

    const viewRegler = regler
      .filter(r => r['view_id'] === view['id'])
      .map(r => String(r['regel'] ?? ''));
    const reglerTekst = viewRegler.length > 0
      ? `\n   Regler:\n${viewRegler.map(r => `   • ${r}`).join('\n')}`
      : '';

    const viewKpi = kpi.filter(k => k['view_id'] === view['id']);
    const kpiTekst = viewKpi.length > 0
      ? '\n   KPI-beregninger (eksisterer IKKE som fysiske kolonner — bruk SQL-uttrykket direkte):\n' +
        viewKpi.map(k => {
          const besk = k['beskrivelse'] ? `\n     Beskrivelse: ${k['beskrivelse']}` : '';
          return `   - Teknisk navn (bruk dette eksakt som alias i SQL): ${k['navn']}\n     Visningsnavn: ${k['visningsnavn']}\n     Format: ${k['format'] ?? 'tall'}\n     SQL: ${k['sql_uttrykk']}${besk}`;
        }).join('\n') +
        '\n\n   REGLER FOR KPI-KOLONNER:\n' +
        '   • Bruk alltid det tekniske navnet eksakt — IKKE modifiser eller legg til ord som "Prosent", "Andel" osv.\n' +
        '     Eksempel: teknisk navn "Lønnsandel" → alias skal være [Lønnsandel], IKKE [LønnsandelProsent]\n' +
        '   • SQL-uttrykket finnes IKKE som fysisk kolonne — aldri referer til teknisk navn i FROM/WHERE, kun i SELECT AS\n' +
        '   • Legg SQL-uttrykket direkte i SELECT (ikke pakk det inn i SUM() eller annen aggregering)\n' +
        '   • ALDRI bruk DATENAME(), MONTH(), YEAR(), DATEPART() for å lage dimensjoner — viewet har egne kolonner\n' +
        '   • For månedsvisning: bruk disse eksakte kolonnene fra viewet: månedsnavn, måned, år, årmåned\n' +
        '   • ALDRI lag egne dimensjonskolonner som Periode, PeriodeNavn, MånedNavn — bruk viewets egne kolonner\n' +
        '   • Eksempel riktig: SELECT [år], [månedsnavn], <sql_uttrykk> AS [Lønnsandel] FROM [view] GROUP BY [år], [månedsnavn], [måned] ORDER BY [år], [måned]\n' +
        '   • Eksempel FEIL: SELECT YEAR(dato), DATENAME(month, dato), SUM(verdi)/SUM(total) AS LønnsandelProsent FROM [view] ...'
      : '';

    const viewEksempler = eksempler.filter(e => e['view_id'] === view['id']);
    const eksempelTekst = viewEksempler.length > 0
      ? `   Eksempelspørringer:\n${viewEksempler.map(e => [e['spørsmål'] ? `   -- ${e['spørsmål']}` : '', e['sql_eksempel'] ? `   ${e['sql_eksempel']}` : ''].filter(Boolean).join('\n')).join('\n')}`
      : '';

    return [
      `### ${view['visningsnavn']}`,
      `   View: ${view['schema_name']}.${view['view_name']}`,
      view['beskrivelse'] ? `   ${view['beskrivelse']}` : '',
      kolonnerTekst ? `   Kolonner:\n${kolonnerTekst}` : '',
      reglerTekst,
      kpiTekst,
      eksempelTekst,
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  // URL-kolonner: vis alltid som lenker
  const urlKolonner = kolonner.filter(k => k['kolonne_type'] === 'url');
  const urlTekst = urlKolonner.length > 0
    ? `\n**URL-kolonner** — vis alltid som klikkbare markdown-lenker:\n${urlKolonner.map(k => `- ${k['kolonne_navn']}: vis som [${k['lenketekst'] || k['kolonne_navn']}](url-verdien)`).join('\n')}`
    : '';

  // Andre views ikke inkludert i prompt
  const utelatteTekst = utelatte.length > 0
    ? `\n*Andre tilgjengelige datakilder (spør meg hvis relevant): ${utelatte.join(', ')}*`
    : '';

  return viewsPrompt + urlTekst + utelatteTekst;
}

async function buildSystemPrompt(
  rapportId?: string | null,
  område?: string | null,
  brukerSpørsmål?: string,
  tillatteViewIds?: string[] | null,
  profilViews?: string[],
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
    const viewsSection = await buildDynamicViewsSection(
      kobletViewIds,
      kobletViewIds ? null : område,
      brukerSpørsmål,
      kobletViewIds,
      kobletViewIds ? null : tillatteViewIds,
      profilViews,
    );
    const iDag = new Date().toLocaleDateString('nb-NO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const prompt = `Dagens dato er ${iDag}.

${SYSTEM_INTRO}

${SQL_REGLER}

${SØKESTRATEGI_REGLER}

## Tilgjengelige datakilder
${viewsSection}`;
    console.log('[buildSystemPrompt] prompt lengde:', prompt.length);
    console.log('[buildSystemPrompt] PROMPT PREVIEW:\n', prompt.slice(0, 2000));
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
  // GET /api/chat/velkomst — personlig velkomstmelding basert på siste aktivitet
  fastify.get(
    '/api/chat/velkomst',
    { preHandler: [resolveTenant] },
    async (request, reply) => {
      const entraId = (request.headers['x-entra-object-id'] as string | undefined)?.trim();
      if (!entraId) return reply.send({ melding: null });

      try {
        // Bruker Prisma (master-DB) — userId er intern Prisma-ID, ikke entraObjectId
        const bruker = await prisma.bruker.findUnique({
          where: { entraObjectId: entraId },
          select: { id: true },
        });
        if (!bruker) return reply.send({ melding: null });

        const sisteHendelse = await prisma.userEvent.findFirst({
          where: { userId: bruker.id, hendelsesType: 'åpnet_rapport' },
          orderBy: { tidspunkt: 'desc' },
          select: { referanseNavn: true },
        });

        const time = new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit' });
        const t = parseInt(time);
        const hilsen = t < 12 ? 'God morgen' : t < 17 ? 'God dag' : 'God kveld';

        let melding = `${hilsen}! `;
        if (sisteHendelse?.referanseNavn) {
          melding += `Sist du var inne åpnet du "${sisteHendelse.referanseNavn}". Vil du fortsette der, eller er det noe annet jeg kan hjelpe med?`;
        } else {
          melding += 'Hva kan jeg hjelpe deg med i dag?';
        }

        return reply.send({ melding });
      } catch {
        return reply.send({ melding: null });
      }
    },
  );

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

      // Hent views brukeren har tilgang til via workspace-kjede:
      // Bruker → Workspace-tilgang → Rapport → ai_rapport_view_kobling → View
      let tillatteViewIds: string[] | null = null;
      if (entraObjectId) {
        try {
          const db = (request as TenantRequest).tenantPrisma;
          const grupper: string[] = request.body.grupper ?? [];
          const identities = [entraObjectId, ...grupper].filter(Boolean);
          const orFilter: Record<string, unknown>[] = [];
          if (identities.length > 0) {
            orFilter.push({ tilgang: { some: { entraId: { in: identities } } } });
          }
          orFilter.push({ opprettetAv: entraObjectId });
          const wsRapporter = await db.workspace.findMany({
            where: { OR: orFilter },
            select: { rapporter: { where: { rapport: { erAktiv: true } }, select: { rapportId: true } } },
          });
          const rapportIds = wsRapporter.flatMap(w => w.rapporter.map(r => r.rapportId));
          if (rapportIds.length > 0) {
            const koblinger = await queryAzureSQL(`
              SELECT DISTINCT view_id FROM ai_rapport_view_kobling
              WHERE rapport_id IN (${rapportIds.map(id => `'${escStr(id)}'`).join(',')})
            `);
            if (koblinger.length > 0) {
              tillatteViewIds = koblinger.map(r => r['view_id'] as string);
              console.log('[Chat] tilgjengelige views via workspace:', tillatteViewIds.length);
            } else {
              console.log('[Chat] ingen view-koblinger funnet for brukerens rapporter — viser alle views');
            }
          }
        } catch (err) {
          console.warn('[Chat] workspace-view tilgang feil — fortsetter uten begrensning:', err instanceof Error ? err.message : err);
        }
      }

      // Hent view-navn for tilgangskontroll i query_database (brukes i openaiService)
      if (tillatteViewIds && tillatteViewIds.length > 0) {
        try {
          const viewNavnRows = await queryAzureSQL(`
            SELECT view_name FROM ai_metadata_views
            WHERE id IN (${tillatteViewIds.map(id => `'${escStr(id)}'`).join(',')}) AND er_aktiv = 1
          `);
          const tillatteViewNavn = viewNavnRows.map(r => String(r['view_name'] ?? '').toLowerCase()).filter(Boolean);
          chatContext = { ...chatContext, tillatteViewNavn };
          console.log('[tilgang] workspace-views:', tillatteViewNavn);
        } catch (err) {
          console.warn('[Chat] view-navn fetch feil:', err instanceof Error ? err.message : err);
        }
      }

      // Hent brukerens profildata tidlig — brukes i rankViews-boost og velkomst
      let profilViews: string[] = [];
      let profilTopRapporter: { navn: string; antall: number }[] = [];
      let profilSisteRapportNavn: string | null = null;
      if (entraObjectId) {
        try {
          const brukerP = await prisma.bruker.findUnique({
            where: { entraObjectId },
            select: { id: true },
          });
          if (brukerP) {
            const [profil, sisteHendelse] = await Promise.all([
              prisma.userProfile.findUnique({ where: { userId: brukerP.id }, select: { aiKontekst: true } }),
              prisma.userEvent.findFirst({
                where: { userId: brukerP.id, hendelsesType: 'åpnet_rapport' },
                orderBy: { tidspunkt: 'desc' },
                select: { referanseNavn: true },
              }),
            ]);
            profilSisteRapportNavn = sisteHendelse?.referanseNavn ?? null;
            if (profil?.aiKontekst) {
              try {
                const k = JSON.parse(profil.aiKontekst) as { topRapporter?: { navn: string; antall: number }[] };
                profilTopRapporter = k.topRapporter ?? [];
                if (profilTopRapporter.length > 0) {
                  const navnListe = profilTopRapporter.slice(0, 3).map(r => `'${escStr(r.navn)}'`).join(', ');
                  const koblingRows = await queryAzureSQL(`
                    SELECT DISTINCT v.view_name
                    FROM ai_rapport_view_kobling k
                    JOIN ai_metadata_views v ON k.view_id = v.id
                    JOIN Rapport r ON k.rapport_id = r.id
                    WHERE r.navn IN (${navnListe})
                  `);
                  profilViews = koblingRows.map(r => String(r['view_name'] ?? '')).filter(Boolean);
                  console.log('[Chat] profilViews fra topRapporter:', profilViews);
                }
              } catch { /* ignorerer ugyldig JSON */ }
            }
          }
        } catch (err) {
          console.warn('[Chat] profil-fetch feil:', err instanceof Error ? err.message : err);
        }
      }

      const tenantSlug = (request.headers['x-tenant-id'] as string | undefined) ?? 'lns';

      // Rydd historikk eldre enn 7 dager (fire-and-forget)
      if (entraObjectId) {
        prisma.chatHistorikk.deleteMany({
          where: { userId: entraObjectId, tidspunkt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        }).catch(() => {});
      }

      // Hent siste samtale fra en tidligere dag (kontekst for AI)
      let historikkTekst = '';
      if (entraObjectId) {
        try {
          const iDagDato = new Date().toISOString().slice(0, 10);
          const tidligereHistorikk = await prisma.chatHistorikk.findMany({
            where: {
              userId: entraObjectId,
              øktId: { not: `${entraObjectId}-${iDagDato}` },
              tenantSlug,
            },
            orderBy: { tidspunkt: 'desc' },
            take: 6,
          });
          if (tidligereHistorikk.length > 0) {
            tidligereHistorikk.reverse();
            historikkTekst = `\nForrige samtale:\n` +
              tidligereHistorikk.map(h =>
                `${h.rolle === 'user' ? 'Bruker' : 'AI'}: ${h.innhold.slice(0, 200)}`
              ).join('\n') + '\n\n';
            console.log('[Chat] historikk fra forrige økt:', tidligereHistorikk.length, 'meldinger');
          }
        } catch { /* ikke kritisk — fortsett uten historikk */ }
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
        const basisPrompt = await buildSystemPrompt(null, null, sisteBrukermelding as string, tillatteViewIds, profilViews);
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
        // Bygg personlig velkomst fra pre-fetched profildata
        let velkomstTekst = '';
        if (profilSisteRapportNavn) {
          const time = new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit' });
          const hilsen = parseInt(time) < 12 ? 'God morgen' : parseInt(time) < 17 ? 'God dag' : 'God kveld';
          velkomstTekst = `${hilsen}! Sist du var inne åpnet du "${profilSisteRapportNavn}". Si ifra om du vil fortsette der eller trenger hjelp med noe annet.\n\n`;
        }
        let profilTekst = '';
        if (profilTopRapporter.length > 0) {
          profilTekst = `\nVIKTIG — Automatisk datakilde-valg:\n` +
            `Brukeren jobber mest med disse rapportene: ${profilTopRapporter.slice(0, 3).map(r => r.navn).join(', ')}.\n` +
            `Når brukeren stiller spørsmål uten å spesifisere datakilde, velg automatisk den dataskilden (view) som er koblet til disse rapportene.\n` +
            `Fortell alltid hvilken datakilde du valgte og hvorfor.\n\n` +
            `Brukerens mest brukte rapporter siste 30 dager:\n` +
            profilTopRapporter.map(r => `- ${r.navn} (${r.antall} ganger)`).join('\n') + '\n';
          if (profilViews.length > 0) {
            profilTekst += `Foretrukkede datakilder basert på brukerprofil: ${profilViews.join(', ')}\n`;
          }
        }
        console.log('[buildSystemPrompt] profilTekst:', profilTekst || '(tom)');
        velkomstTekst += profilTekst;

        let ingenRapportPrompt = `${historikkTekst}${velkomstTekst}Du er en dataassistent for LNS Dataportal.
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
        let fullAiTekst = '';
        const writeOgCapture = (chunk: unknown) => {
          write(chunk);
          const c = chunk as Record<string, unknown>;
          if (c.type === 'text' && typeof c.content === 'string') fullAiTekst += c.content;
        };

        try {
          await chat(messages, ingenRapportPrompt, writeOgCapture, chatContext);
        } catch (err) {
          write({ type: 'error', message: err instanceof Error ? err.message : 'Ukjent feil' });
        } finally {
          reply.raw.end();
        }
        // Lagre samtale i historikk (fire-and-forget)
        if (entraObjectId && String(sisteBrukermelding).trim() && fullAiTekst) {
          const iDagDato = new Date().toISOString().slice(0, 10);
          const øktId = `${entraObjectId}-${iDagDato}`;
          prisma.chatHistorikk.createMany({
            data: [
              { userId: entraObjectId, rolle: 'user',      innhold: String(sisteBrukermelding).slice(0, 4000), øktId, tenantSlug },
              { userId: entraObjectId, rolle: 'assistant', innhold: fullAiTekst.slice(0, 4000),                øktId, tenantSlug },
            ],
          }).catch(() => {});
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
      const basisPrompt = await buildSystemPrompt(rapportId, rapportOmråde, sisteBrukermelding as string, tillatteViewIds, profilViews);

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

      let rapportKontekst = `${historikkTekst}Du er en dataassistent for LNS Dataportal.

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
      let fullAiTekstRapport = '';
      const writeOgCapture = (chunk: unknown) => {
        write(chunk);
        const c = chunk as Record<string, unknown>;
        if (c.type === 'text' && typeof c.content === 'string') fullAiTekstRapport += c.content;
      };

      try {
        await chat(messages, rapportKontekst, writeOgCapture, chatContext);
      } catch (err) {
        console.error('[chat] feil:', err);
        write({ type: 'error', message: err instanceof Error ? err.message : 'Ukjent feil' });
      } finally {
        reply.raw.end();
      }
      // Lagre samtale i historikk (fire-and-forget)
      if (entraObjectId && String(sisteBrukermelding).trim() && fullAiTekstRapport) {
        const iDagDato = new Date().toISOString().slice(0, 10);
        const øktId = `${entraObjectId}-${iDagDato}`;
        prisma.chatHistorikk.createMany({
          data: [
            { userId: entraObjectId, rolle: 'user',      innhold: String(sisteBrukermelding).slice(0, 4000), øktId, tenantSlug },
            { userId: entraObjectId, rolle: 'assistant', innhold: fullAiTekstRapport.slice(0, 4000),         øktId, tenantSlug },
          ],
        }).catch(() => {});
      }
    },
  );
}
