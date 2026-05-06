import OpenAI from 'openai';
import { executeQuery } from './fabricService';
import { queryAzureSQL } from './azureSqlService';
import { prisma } from '../lib/prisma';

console.log('[OpenAI] Konfigurasjon:', {
  endpoint:   process.env.AZURE_OPENAI_ENDPOINT,
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
  hasKey:     !!process.env.AZURE_OPENAI_KEY,
});

/**
 * Konverterer MySQL/PostgreSQL SQL-syntax til Azure SQL (T-SQL).
 * Håndterer LIMIT → TOP og LIMIT/OFFSET → OFFSET/FETCH.
 */
function sanitizeSQL(sql: string): string {
  // Case 1: LIMIT n OFFSET m → ORDER BY ... OFFSET m ROWS FETCH NEXT n ROWS ONLY
  const limitOffsetMatch = sql.match(/\bLIMIT\s+(\d+)\s+OFFSET\s+(\d+)\b/i);
  if (limitOffsetMatch) {
    const antall = limitOffsetMatch[1];
    const skip   = limitOffsetMatch[2];
    let fixed = sql.replace(/\s*\bLIMIT\s+\d+\s+OFFSET\s+\d+\b/i, '');
    if (!/\bORDER\s+BY\b/i.test(fixed)) {
      fixed = fixed.trimEnd() + ' ORDER BY (SELECT NULL)';
    }
    fixed = fixed.trimEnd() + ` OFFSET ${skip} ROWS FETCH NEXT ${antall} ROWS ONLY`;
    console.log('[SQL] konverterte LIMIT/OFFSET til OFFSET/FETCH:', fixed);
    return fixed;
  }

  // Case 2: LIMIT n → SELECT TOP n
  const limitMatch = sql.match(/\bLIMIT\s+(\d+)\b/i);
  if (limitMatch) {
    const antall = limitMatch[1];
    let fixed = sql.replace(/\s*\bLIMIT\s+\d+\b/i, '');
    fixed = fixed.replace(/\bSELECT\s+/i, `SELECT TOP ${antall} `);
    console.log('[SQL] konverterte LIMIT til TOP:', fixed);
    return fixed;
  }

  return sql;
}

const client = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY ?? '',
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
  defaultQuery: { 'api-version': '2024-02-01' },
  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_KEY ?? '' },
});

export type SseChunk =
  | { type: 'text';                 content: string }
  | { type: 'tool_call';            tool: string; result: unknown }
  | { type: 'filter';               filterConfig: FilterConfig }
  | { type: 'slicer';               config: SlicerConfig }
  | { type: 'slicer_clear';         tittel: string }
  | { type: 'open_report';          rapportId: string; rapportNavn: string }
  | { type: 'query_result';         data: Record<string, unknown>[]; sql: string }
  | { type: 'rapport_forslag';      forslag: RapportForslag }
  | { type: 'conversation_history'; messages: ChatMessage[] }
  | { type: 'done' };

export interface RapportForslag {
  tittel: string;
  beskrivelse?: string;
  visualType: string;
  xAkse?: string;
  yAkse?: string;
  grupperPaa?: string;
  sql: string;
  data: Record<string, unknown>[];
  foreslåSlicere?: string[];
  alleViewKolonner?: { kolonne_navn: string; kolonne_type: string; sql_uttrykk?: string; visningsnavn?: string; format?: string }[];
  viewNavn?: string | null;
  prosjektNr?: string | null;
  prosjektNavn?: string | null;
  prosjektKolonne?: string | null;
  prosjektKolonneType?: string | null;
  prosjektFilter?: string | null;
  laastFilter?: { kolonne: string; verdi: string } | null;
  referanseLinje?: { verdi: number; etikett?: string; farge?: string } | null;
}

export interface FilterConfig {
  table: string;
  column: string;
  values: (string | number)[];
  operator?: 'In' | 'NotIn' | 'All';
}

// Slicer-typer. Speiler portal/lib/slicerOps.ts (samme JSON-shape over SSE).
export interface HierarchyLevel {
  verdi: string | number;
  barn?: HierarchyLevel[];
}

export type SlicerConfig =
  | { tittel: string; type: 'basic';     verdier: (string | number)[] }
  | { tittel: string; type: 'hierarchy'; nivåer:  HierarchyLevel[] };

interface SlicerMeta {
  visualName: string;
  tittel:     string;
}

export interface BasicSlicerInfo extends SlicerMeta {
  type:        'basic';
  target:      { table: string; column: string } | null;
  kolonneType: 'string' | 'number';
  verdier:     string[];
}

export interface HierarchySlicerInfo extends SlicerMeta {
  type:            'hierarchy';
  targets:         Array<{ table: string; column: string }>;
  toppNivåVerdier: string[];
  barnPerForelder: Record<string, string[]>;
}

export type SlicerInfo = BasicSlicerInfo | HierarchySlicerInfo;

export type SlicerSeleksjon =
  | { type: 'basic';     verdier: (string | number)[] }
  | { type: 'hierarchy'; nivåer:  HierarchyLevel[] }
  | null;

export type SlicerState = Record<string, SlicerSeleksjon>;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface ChatContext {
  entraObjectId?: string;
  isAdmin?: boolean;
  kanLageRapport?: boolean;
  pbiDatasetId?: string;
  pbiWorkspaceId?: string;
  kildePbiReportId?: string;
  prosjektNr?: string | null;
  prosjektNavn?: string | null;
  /** Tillatte view-navn (lowercase) for denne brukeren — undefined = ingen begrensning */
  tillatteViewNavn?: string[];
}

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'query_database',
      description: 'Kjør en SELECT-spørring mot SQL views. ai_gold schema ligger i Azure SQL. Bruk når brukeren spør om rapportdata eller rapportkatalog.',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'SQL SELECT-spørring mot datavarehus, f.eks. SELECT SUM(AntallBolter) FROM ai_gold.vw_Fact_Bolting_BeverBas WHERE år = 2026 AND ukenr = 10. Bruk IKKE for rapportsøk — bruk search_portal_reports i stedet.',
          },
        },
        required: ['sql'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_report_filter',
      description: 'Setter et filter i Power BI-rapporten for brukeren. Bruk når brukeren ber om å filtrere rapporten.',
      parameters: {
        type: 'object',
        properties: {
          table: {
            type: 'string',
            description: 'Tabellnavnet i Power BI-datamodellen (ikke SQL-tabellen).',
          },
          column: {
            type: 'string',
            description: 'Kolonnenavnet å filtrere på.',
          },
          values: {
            type: 'array',
            items: { type: ['string', 'number'] },
            description: 'Liste med verdier å filtrere på.',
          },
          operator: {
            type: 'string',
            enum: ['In', 'NotIn', 'All'],
            description: 'Filteroperator. Standard: In.',
          },
        },
        required: ['table', 'column', 'values'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_report_slicer',
      description:
        'Setter en slicer i Power BI-rapporten. ' +
        'For vanlige slicere: bruk type="basic" med "verdier". ' +
        'For hierarki-slicere (slicere markert som type="hierarchy" i activeSlicerState): bruk type="hierarchy" med "nivåer". ' +
        'Bruk når brukeren ber om å vise spesifikke verdier, f.eks. "vis kun profil 3493" eller "sett år til 2026 og uke 9".',
      parameters: {
        type: 'object',
        properties: {
          tittel: {
            type: 'string',
            description: 'Tittelen på sliceren slik den fremkommer i slicere-listen, f.eks. "Tid", "Profil", "Region".',
          },
          type: {
            type: 'string',
            enum: ['basic', 'hierarchy'],
            description:
              'Slicer-type. Bruk "basic" for vanlige slicere med én kolonne. ' +
              'Bruk "hierarchy" for slicere med flere nivåer (typisk Tid: År + Uke/Måned).',
          },
          verdier: {
            type: 'array',
            items: { type: ['string', 'number'] },
            description: 'BARE for type="basic". Eksakte verdier som skal velges. Må matche verdiene i slicere-listen.',
          },
          nivåer: {
            type: 'array',
            description:
              'BARE for type="hierarchy". Topp-nivå-noder. ' +
              'Hver node har "verdi" (f.eks. årstall) og evt. "barn" (f.eks. uker/måneder). ' +
              'Hvis "barn" er udefinert eller tom, velges hele nivået under. ' +
              'Maks 3 nivåer (Year-Quarter-Month eller Year-Month-Day) — Power BI støtter dypere, ' +
              'men det er sjelden behov.',
            items: {
              type: 'object',
              properties: {
                verdi: { type: ['string', 'number'] },
                barn: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      verdi: { type: ['string', 'number'] },
                      barn: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: { verdi: { type: ['string', 'number'] } },
                          required: ['verdi'],
                        },
                      },
                    },
                    required: ['verdi'],
                  },
                },
              },
              required: ['verdi'],
            },
          },
        },
        required: ['tittel', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_report',
      description: 'Åpner en rapport i portalen. Bruk når brukeren vil åpne en rapport. rapportId skal være portal-UUID (id-feltet fra search_portal_reports), ikke pbiReportId.',
      parameters: {
        type: 'object',
        properties: {
          rapportId: {
            type: 'string',
            description: 'Portal-UUID for rapporten — bruk id-feltet fra search_portal_reports-resultatet.',
          },
          rapportNavn: {
            type: 'string',
            description: 'Navn på rapporten som skal åpnes.',
          },
        },
        required: ['rapportId', 'rapportNavn'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_portal_reports',
      description: 'Søk i portalen etter tilgjengelige rapporter. Bruk ALLTID denne når brukeren spør om rapporter, vil finne eller åpne en rapport. Returnerer id (portal-UUID), navn, område, beskrivelse, nøkkelord og workspace_navn for rapporter brukeren har tilgang til.',
      parameters: {
        type: 'object',
        properties: {
          sokeord: {
            type: 'string',
            description: 'Søkeord å filtrere på (søker i navn, område, beskrivelse og nøkkelord). Tom streng returnerer alle tilgjengelige rapporter.',
          },
        },
        required: ['sokeord'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_report_slicer',
      description: 'Fjern/nullstill en slicer i Power BI-rapporten. Bruk når brukeren ber om å fjerne, nullstille eller ta bort et filter/slicer.',
      parameters: {
        type: 'object',
        properties: {
          tittel: {
            type: 'string',
            description: 'Tittelen på sliceren som skal nullstilles, f.eks. "Tid", "Profil".',
          },
        },
        required: ['tittel'],
      },
    },
  },
];

const opprettKpiTool: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'opprett_kpi',
    description:
      'Oppretter en ny KPI i systemet basert på brukerens beskrivelse av beregningslogikk. ' +
      'Kall dette BARE etter at brukeren har bekreftet hvordan KPI-en beregnes og du har oversatt det til SQL. ' +
      'Ikke kall dette uten eksplisitt bekreftelse fra bruker.',
    parameters: {
      type: 'object',
      properties: {
        view_navn: {
          type: 'string',
          description: 'Fullt view-navn inkl. schema, f.eks. ai_gold.vw_Fact_Regnskapstransksjoner',
        },
        navn: {
          type: 'string',
          description: 'Teknisk navn uten mellomrom, f.eks. Dekningsbidrag',
        },
        visningsnavn: {
          type: 'string',
          description: 'Lesbart navn for brukere, f.eks. "Dekningsbidrag %"',
        },
        sql_uttrykk: {
          type: 'string',
          description: 'Fullstendig SQL-aggregeringsuttrykk, f.eks. CAST(SUM(omsetning - varekostnad) AS FLOAT) / NULLIF(SUM(omsetning), 0)',
        },
        format: {
          type: 'string',
          enum: ['prosent', 'nok', 'antall', 'desimal'],
          description: 'Format: prosent (%), nok (kr), antall (heltall), desimal',
        },
        beskrivelse: {
          type: 'string',
          description: 'Forklaring av hva KPI-en måler (valgfritt)',
        },
      },
      required: ['view_navn', 'navn', 'visningsnavn', 'sql_uttrykk', 'format'],
    },
  },
};

const createReportTool: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'create_report',
    description: 'Lag en interaktiv datarapport basert på SQL-view data. Hent data og presenter som en strukturert rapport med chart og tabell. Bruk KUN når brukeren eksplisitt ber om å lage eller opprette en rapport.',
    parameters: {
      type: 'object',
      properties: {
        tittel:      { type: 'string', description: 'Navn på rapporten' },
        beskrivelse: { type: 'string', description: 'Kort beskrivelse av hva rapporten viser' },
        sql: {
          type: 'string',
          description:
            'SQL SELECT-spørring mot ai_gold view for å hente rapport-data. Bruk TOP 200 for begrensning. ' +
            'KRITISK: Alias i SELECT MÅ matche eksakt kolonnenavn fra viewet. ' +
            'Bruk ALDRI beskrivende navn som TotalLønnskostnader eller AntallRUH — ' +
            'bruk originalnavnet: SUM([Beløp]) AS [Beløp], SUM([Antall]) AS [Antall]. ' +
            'VIKTIG for WHERE: Skriv ALLTID enkle betingelser uten ytre parenteser: ' +
            '✅ WHERE [år] = 2026 AND [måned] = 3  ' +
            '❌ WHERE ([år] = 2026 AND [måned] = 3)  — parenteser rundt WHERE-blokken bryter filter-parsingen.',
        },
        visualType: {
          type: 'string',
          enum: ['bar', 'line', 'pie', 'table', 'card'],
          description: 'Primær visualiseringstype: bar=søylediagram, line=linjediagram, pie=kakediagram, table=tabell, card=KPI-nøkkeltall',
        },
        xAkse: {
          type: 'string',
          description:
            'Kolonnenavn for X-aksen. MÅ være eksakt lik aliaset i SQL SELECT-setningen ' +
            'og et gyldig kolonnenavn fra viewet. Eks: "månedsnavn", "Ansvarlig".',
        },
        yAkse: {
          type: 'string',
          description:
            'Kolonnenavn for Y-aksen. MÅ være eksakt lik aliaset i SQL SELECT-setningen ' +
            'og et gyldig kolonnenavn fra viewet. ' +
            'ALDRI bruk beskrivende navn som TotalLønnskostnader, AntallRUH, SumBeløp — ' +
            'bruk originalnavnet fra viewet: "Beløp", "Antall", "OverheadProsent". ' +
            'Konsistens mellom SQL-alias og yAkse er kritisk.',
        },
        grupperPaa:  { type: 'string', description: 'Kolonnenavn å farge/gruppere dataserier på (valgfritt)' },
        kpi_referanser: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Tekniske navn på KPIer som skal inngå som mål-kolonner (teknisk navn fra "Teknisk navn"-feltet i KPI-listen i systempromptet). ' +
            'BRUK ALLTID dette feltet når rapporten involverer en KPI som er definert i ai_metadata_kpi — aldri regenerer SQL-uttrykket selv. ' +
            'Backend henter og injiserer korrekt SQL-uttrykk basert på navnene. ' +
            'Eksempel: ["Lønnsandel", "OverheadProsent"]. ' +
            'I sql-parameteren: ta kun med dimensjons-kolonner (månedsnavn, år osv.) + FROM/WHERE/GROUP BY — IKKE beregn KPI-kolonner der.',
        },
        foreslåSlicere: { type: 'array', items: { type: 'string' }, description: 'Filtre/dimensjoner brukeren kan interagere med' },
        referanseLinje: {
          type: 'object',
          description: 'Referanselinje i diagrammet. Bruk når bruker nevner grenseverdi, mål, budsjett eller terskel.',
          properties: {
            verdi:   { type: 'number', description: 'Y-verdien for referanselinjen, f.eks. 5 for 5%, 1000000 for 1 million' },
            etikett: { type: 'string', description: 'Tekst som vises ved linjen, f.eks. "Mål 5%" eller "Budsjett"' },
            farge:   { type: 'string', description: 'Farge på linjen, f.eks. "#e05c5c" for rød eller "#f5a623" for gull' },
          },
          required: ['verdi'],
        },
      },
      required: ['tittel', 'sql', 'visualType'],
    },
  },
};

console.log('[OpenAI] tools registrert:', tools.map((t) => ('function' in t ? t.function.name : 'ukjent')));

function historyToMessages(history: OpenAI.Chat.ChatCompletionMessageParam[]): ChatMessage[] {
  return history.map((h) => {
    if (h.role === 'tool') {
      return { role: 'tool' as const, content: typeof h.content === 'string' ? h.content : '', tool_call_id: h.tool_call_id };
    }
    if (h.role === 'assistant') {
      const msg: ChatMessage = { role: 'assistant' as const, content: typeof h.content === 'string' ? h.content : null };
      if (h.tool_calls) {
        msg.tool_calls = h.tool_calls
          .filter((tc) => tc.type === 'function' && 'function' in tc)
          .map((tc) => {
            const fn = (tc as { id: string; type: 'function'; function: { name: string; arguments: string } }).function;
            return { id: tc.id, type: 'function' as const, function: { name: fn.name, arguments: fn.arguments } };
          });
      }
      return msg;
    }
    return { role: h.role as 'user', content: typeof h.content === 'string' ? h.content : '' };
  });
}

function buildSystemPrompt(rapportKontekst?: string): string {
  if (rapportKontekst) return rapportKontekst;
  return [
    'Du er en dataassistent for PBI Portal.',
    'Når du skal hente data, bruk query_database tool mot Fabric datawarehouse.',
    'Svar alltid på norsk. Vær konkret med tall og datoer.',
  ].join('\n');
}

export async function chat(
  messages: ChatMessage[],
  rapportKontekst: string | undefined,
  onChunk: (chunk: SseChunk) => void,
  context?: ChatContext,
): Promise<void> {
  const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
    role: 'system',
    content: buildSystemPrompt(rapportKontekst),
  };

  const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
    systemMessage,
    ...messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content ?? '',
          tool_call_id: m.tool_call_id ?? '',
        };
      }
      if (m.role === 'assistant' && m.tool_calls) {
        return {
          role: 'assistant' as const,
          content: m.content ?? null,
          tool_calls: m.tool_calls,
        };
      }
      return {
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content ?? '',
      };
    }),
  ];

  const activeTools = context?.kanLageRapport
    ? [...tools, opprettKpiTool, createReportTool]
    : tools;

  // Recursive tool-call loop
  for (let i = 0; i < 8; i++) {
    const stream = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o',
      messages: history,
      tools: activeTools,
      tool_choice: 'auto',
      stream: true,
    });

    let assistantContent = '';
    const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        assistantContent += delta.content;
        onChunk({ type: 'text', content: delta.content });
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' });
          }
          const entry = toolCallsMap.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
        }
      }
    }

    // If no tool calls, we're done — push final assistant text to history first, then emit frontend-safe history.
    // Tool-meldinger strippes: backend renser ved neste request, og AI kan re-kalle tools ved behov.
    if (toolCallsMap.size === 0) {
      if (assistantContent) {
        history.push({ role: 'assistant', content: assistantContent });
      }
      const allMessages   = historyToMessages(history.slice(1));
      const frontendHistory = allMessages.filter(
        (m) => m.role === 'user' || (m.role === 'assistant' && !(m.tool_calls?.length)),
      );
      onChunk({ type: 'conversation_history', messages: frontendHistory });
      onChunk({ type: 'done' });
      return;
    }

    // Add assistant message with tool calls
    const toolCallsList = Array.from(toolCallsMap.values());
    history.push({
      role: 'assistant',
      content: assistantContent || null,
      tool_calls: toolCallsList.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.args },
      })),
    });

    // Execute each tool call
    for (const tc of toolCallsList) {
      let result: unknown;
      let args: Record<string, unknown>;

      try {
        args = JSON.parse(tc.args) as Record<string, unknown>;
      } catch {
        args = {};
      }

      console.log('[OpenAI] tool call:', tc.name, tc.args);

      try {
        if (tc.name === 'search_portal_reports') {
          const sokeord = (args['sokeord'] as string | undefined) ?? '';
          console.log('[search_portal_reports] sokeord:', JSON.stringify(sokeord));
          console.log('[search_portal_reports] context:', JSON.stringify(context));

          const entraObjectId = context?.entraObjectId;
          const isAdmin       = context?.isAdmin ?? false;

          // Split søkeord på mellomrom — hvert ord må matche minst én kolonne (AND)
          const ord = sokeord.split(/\s+/).map(o => o.trim()).filter(o => o.length > 1);
          console.log('[search_portal_reports] ord:', JSON.stringify(ord));

          type RapportResult = { id: string; navn: string; område: string | null; beskrivelse: string | null; nøkkelord: string | null; workspace_navn: string };
          let rapporter: RapportResult[];

          if (isAdmin) {
            const rader = await prisma.rapport.findMany({
              where: {
                erAktiv: true,
                ...(ord.length > 0 ? {
                  // Hvert ord må matche minst én kolonne (AND av OR-er)
                  AND: ord.map(o => ({
                    OR: [
                      { navn:        { contains: o } },
                      { område:      { contains: o } },
                      { beskrivelse: { contains: o } },
                      { nøkkelord:   { contains: o } },
                      { workspaces:  { some: { workspace: { navn: { contains: o } } } } },
                    ],
                  })),
                } : {}),
              },
              select: {
                id: true, navn: true, område: true, beskrivelse: true, nøkkelord: true,
                workspaces: { select: { workspace: { select: { navn: true } } } },
              },
              orderBy: { navn: 'asc' },
            });
            // Én entry per rapport×workspace (admin ser alle workspaces)
            rapporter = [];
            for (const r of rader) {
              const wsNavnList = r.workspaces.map((w) => w.workspace.navn);
              if (wsNavnList.length === 0) {
                rapporter.push({ id: r.id, navn: r.navn, område: r.område, beskrivelse: r.beskrivelse, nøkkelord: r.nøkkelord, workspace_navn: '' });
              } else {
                for (const wsNavn of wsNavnList) {
                  rapporter.push({ id: r.id, navn: r.navn, område: r.område, beskrivelse: r.beskrivelse, nøkkelord: r.nøkkelord, workspace_navn: wsNavn });
                }
              }
            }
            rapporter.sort((a, b) => a.workspace_navn.localeCompare(b.workspace_navn) || a.navn.localeCompare(b.navn));
          } else if (entraObjectId) {
            // Finn workspaces brukeren har tilgang til
            const tilgangWorkspaces = await prisma.tilgang.findMany({
              where: { entraId: entraObjectId },
              select: { workspaceId: true },
            });
            const workspaceIds = tilgangWorkspaces.map((t) => t.workspaceId);

            // Hent rapporter i disse workspacene (inkl. workspace-navn, kun aktive)
            const links = await prisma.workspaceRapport.findMany({
              where: { workspaceId: { in: workspaceIds }, rapport: { erAktiv: true } },
              select: {
                workspace: { select: { navn: true } },
                rapport: {
                  select: {
                    id: true, navn: true, område: true, beskrivelse: true, nøkkelord: true, pbiReportId: true,
                    tilgang: { select: { entraId: true } },
                  },
                },
              },
            });

            // List én entry per rapport×workspace-kombinasjon (dedup på rapport+workspace)
            const seen = new Set<string>(); // key: rapport_id::workspace_navn
            rapporter = [];
            for (const link of links) {
              const r       = link.rapport;
              const wsNavn  = link.workspace.navn;
              const key     = `${r.id}::${wsNavn}`;
              if (seen.has(key)) continue;
              if (r.tilgang.length > 0 && !r.tilgang.some((t) => t.entraId === entraObjectId)) continue;
              if (ord.length > 0) {
                // Hvert ord må treffe minst én kolonne (AND av OR-er)
                const treff = ord.every(o => {
                  const s = o.toLowerCase();
                  return (
                    r.navn.toLowerCase().includes(s) ||
                    (r.område ?? '').toLowerCase().includes(s) ||
                    (r.beskrivelse ?? '').toLowerCase().includes(s) ||
                    (r.nøkkelord ?? '').toLowerCase().includes(s) ||
                    wsNavn.toLowerCase().includes(s)
                  );
                });
                if (!treff) continue;
              }
              seen.add(key);
              rapporter.push({
                id: r.id,
                navn: r.navn,
                område: r.område,
                beskrivelse: r.beskrivelse,
                nøkkelord: r.nøkkelord,
                workspace_navn: wsNavn,
              });
            }
            rapporter.sort((a, b) => a.workspace_navn.localeCompare(b.workspace_navn) || a.navn.localeCompare(b.navn));
          } else {
            rapporter = [];
          }

          // Nummerér entries autoritativt — nr er fasit for "åpne nr X"
          const rapporterMedNr = rapporter.map((r, i) => ({
            nr: i + 1,
            id: r.id,
            navn: r.navn,
            område: r.område,
            beskrivelse: r.beskrivelse,
            workspace_navn: r.workspace_navn,
          }));

          console.log('[search_portal_reports] funnet:', rapporterMedNr.length);
          console.log('[search_portal_reports] sender til AI:', JSON.stringify(
            rapporterMedNr.map(r => ({ nr: r.nr, id: r.id, navn: r.navn, workspace: r.workspace_navn })), null, 2
          ));
          result = { rapporter: rapporterMedNr };
        } else if (tc.name === 'query_database') {
          const rawSQL   = args['sql'] as string;
          const sqlQuery = sanitizeSQL(rawSQL);

          // Tilgangskontroll: avvis SQL som refererer views utenfor brukerens workspace-tilgang
          if (context?.tillatteViewNavn && context.tillatteViewNavn.length > 0) {
            const sqlLower = sqlQuery.toLowerCase();
            // Norsk-safe regex: \w stopper ved æøå — bruk eksplisitt tegnklasse
            const norskBokstav = '[a-zA-ZæøåÆØÅ0-9_]';
            const sqlViewRegex = new RegExp(`(${norskBokstav}+\\.${norskBokstav}+)`, 'gi');
            // Strip schema-prefix (f.eks. ai_gold.vw_Fact_X → vw_fact_x) før sammenligning.
            // workspace-lista inneholder kun view-navn uten schema.
            const viewsISql = (sqlLower.match(sqlViewRegex) ?? []).map(v => {
              const deler = v.toLowerCase().split('.');
              return deler[deler.length - 1];
            }).filter(v => v.startsWith('vw_'));
            const ikketillatt = viewsISql.filter(v =>
              !context.tillatteViewNavn!.some(t => t.toLowerCase() === v)
            );
            console.log('[tilgang] SQL views (uten schema):', viewsISql);
            if (ikketillatt.length > 0) {
              console.warn('[tilgang] SQL refererer ikke-tillatte views:', ikketillatt);
              result = { error: 'Du har ikke tilgang til denne datakilden.' };
            }
          }

          if (!result) {
            console.log('[OpenAI] query_database:', sqlQuery);
            const isAzureSql = /ai_gold\./i.test(sqlQuery);
            console.log('[OpenAI] ruter til:', isAzureSql ? 'Azure SQL' : 'Fabric');
            if (isAzureSql) {
              const rows = await queryAzureSQL(sqlQuery, 200);
              onChunk({ type: 'query_result', data: rows, sql: sqlQuery });
              result = { rows };
            } else {
              const fabricResult = await executeQuery(sqlQuery, 200);
              const rows = (fabricResult as { rows?: Record<string, unknown>[] })?.rows;
              if (rows) onChunk({ type: 'query_result', data: rows, sql: sqlQuery });
              result = fabricResult;
            }
          }
        } else if (tc.name === 'set_report_filter') {
          const filterConfig: FilterConfig = {
            table:    args['table'] as string,
            column:   args['column'] as string,
            values:   args['values'] as (string | number)[],
            operator: (args['operator'] as FilterConfig['operator']) ?? 'In',
          };
          onChunk({ type: 'filter', filterConfig });
          result = { success: true, message: 'Filter satt i rapporten.' };
        } else if (tc.name === 'set_report_slicer') {
          const tittel  = args['tittel']  as string | undefined;
          const type    = args['type']    as 'basic' | 'hierarchy' | undefined;
          const verdier = args['verdier'] as (string | number)[] | undefined;
          const nivåer  = args['nivåer']  as HierarchyLevel[] | undefined;

          if (!tittel) {
            result = { error: 'Mangler tittel — angi slicerens tittel slik den fremkommer i slicere-listen.' };
          } else if (type !== 'basic' && type !== 'hierarchy') {
            result = { error: 'Mangler eller ugyldig type — angi "basic" eller "hierarchy".' };
          } else if (type === 'basic' && (!verdier || verdier.length === 0)) {
            result = { error: 'type="basic" krever verdier-array med minst én verdi.' };
          } else if (type === 'basic' && nivåer !== undefined) {
            result = { error: 'type="basic" skal ikke ha nivåer. Hvis sliceren er hierarkisk, bruk type="hierarchy" i stedet.' };
          } else if (type === 'hierarchy' && (!nivåer || nivåer.length === 0)) {
            result = { error: 'type="hierarchy" krever nivåer-array med minst ett nivå.' };
          } else if (type === 'hierarchy' && verdier !== undefined) {
            result = { error: 'type="hierarchy" skal ikke ha verdier. Hvis sliceren ikke er hierarkisk, bruk type="basic" i stedet.' };
          } else {
            const config: SlicerConfig = type === 'basic'
              ? { tittel, type: 'basic',     verdier: verdier as (string | number)[] }
              : { tittel, type: 'hierarchy', nivåer:  nivåer  as HierarchyLevel[] };
            console.log('[backend] sending slicer SSE event:', JSON.stringify(config));
            onChunk({ type: 'slicer', config });
            const beskrivelse = config.type === 'basic'
              ? `verdier=[${config.verdier.join(', ')}]`
              : `nivåer=${JSON.stringify(config.nivåer)}`;
            result = { success: true, message: `Slicer "${tittel}" satt (${type}) — ${beskrivelse}.` };
          }
        } else if (tc.name === 'clear_report_slicer') {
          const tittel = args['tittel'] as string | undefined;
          if (!tittel) {
            result = { error: 'Mangler tittel — angi slicerens tittel.' };
          } else {
            onChunk({ type: 'slicer_clear', tittel });
            result = { success: true, message: `Slicer "${tittel}" nullstilt.` };
          }
        } else if (tc.name === 'open_report') {
          const rapportId   = args['rapportId'] as string;
          const rapportNavn = args['rapportNavn'] as string;
          // Prøv portal-UUID først, deretter pbiReportId som fallback
          let portalId = rapportId;
          const byPortalId = await prisma.rapport.findUnique({ where: { id: rapportId } });
          if (!byPortalId) {
            const byPbiId = await prisma.rapport.findFirst({ where: { pbiReportId: rapportId } });
            portalId = byPbiId?.id ?? rapportId;
          }
          console.log(`[OpenAI] open_report: rapportId=${rapportId} → portalId=${portalId}`);
          onChunk({ type: 'open_report', rapportId: portalId, rapportNavn });
          result = { success: true, message: `Åpner rapport: ${rapportNavn}` };
        } else if (tc.name === 'create_report') {
          if (!context?.kanLageRapport) {
            result = { error: 'Du har ikke tilgang til å opprette rapporter.' };
          } else {
            const rawSQL   = args['sql'] as string;
            let sqlQuery   = sanitizeSQL(rawSQL);

            // ── KPI-injeksjon ─────────────────────────────────────────────
            // Når kpi_referanser er satt, henter vi SQL-uttrykk fra ai_metadata_kpi
            // og injiserer dem i SELECT FØR vi kjører spørringen og validerer yAkse.
            const kpiReferanser = args['kpi_referanser'] as string[] | undefined;
            if (kpiReferanser && kpiReferanser.length > 0) {
              // Ekstraher view-navn fra SQL for å slå opp riktig KPI-sett
              const kpiViewMatch  = sqlQuery.match(/\bFROM\s+([\w]+\.[\w]+)/i);
              const kpiViewFull   = kpiViewMatch?.[1] ?? null;
              const kpiSchema     = kpiViewFull?.split('.')[0] ?? 'ai_gold';
              const kpiViewNavn   = kpiViewFull?.split('.')[1] ?? null;
              console.log('[create_report] kpi_referanser:', kpiReferanser, '| view:', kpiViewFull);

              if (!kpiViewNavn) {
                result = { error: 'kpi_referanser krever at sql-parameteren inneholder en gyldig FROM ai_gold.<view>-klausul.' };
                onChunk({ type: 'tool_call', tool: tc.name, result });
                history.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id });
                continue;
              }

              try {
                const navnListe = kpiReferanser.map(n => `'${n.replace(/'/g, "''")}'`).join(', ');
                const kpiRader = await queryAzureSQL(`
                  SELECT k.navn, k.sql_uttrykk, k.visningsnavn
                  FROM ai_metadata_kpi k
                  JOIN ai_metadata_views v ON k.view_id = v.id
                  WHERE v.schema_name = '${kpiSchema.replace(/'/g, "''")}' AND v.view_name = '${kpiViewNavn.replace(/'/g, "''")}'
                    AND k.navn IN (${navnListe}) AND k.er_aktiv = 1
                `);
                console.log('[create_report] KPI-rader funnet:', kpiRader.length, 'av', kpiReferanser.length, 'forespurte');

                const funnet    = new Set(kpiRader.map(r => String(r['navn'])));
                const manglende = kpiReferanser.filter(n => !funnet.has(n));
                if (manglende.length > 0) {
                  result = { error: `KPI-er ikke funnet i ai_metadata_kpi: ${manglende.join(', ')}. Sjekk at teknisk navn stemmer eksakt med KPI-listen i systempromptet.` };
                  onChunk({ type: 'tool_call', tool: tc.name, result });
                  history.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id });
                  continue;
                }

                // Bygg KPI SELECT-fragmenter og injiser FØR FROM-klausulen
                const kpiCols = kpiRader
                  .map(r => `${String(r['sql_uttrykk'])} AS [${String(r['navn'])}]`)
                  .join(', ');
                const fromPos = sqlQuery.search(/\bFROM\b/i);
                if (fromPos > 0) {
                  sqlQuery = `${sqlQuery.slice(0, fromPos).trimEnd()}, ${kpiCols} ${sqlQuery.slice(fromPos)}`;
                  console.log('[create_report] SQL etter KPI-injeksjon:', sqlQuery.slice(0, 200));
                }
              } catch (kpiLookupErr) {
                const msg = kpiLookupErr instanceof Error ? kpiLookupErr.message : String(kpiLookupErr);
                console.error('[create_report] KPI-oppslag feilet:', msg);
                result = { error: `Kunne ikke hente KPI-SQL fra databasen: ${msg}` };
                onChunk({ type: 'tool_call', tool: tc.name, result });
                history.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id });
                continue;
              }
            }
            // ── Slutt KPI-injeksjon ───────────────────────────────────────

            console.log('[OpenAI] create_report SQL:', sqlQuery);

            // Pre-validering: sjekk yAkse mot SQL-aliaser FØR DB-kall
            const yAkseInput = args['yAkse'] as string | undefined;
            if (yAkseInput) {
              const aliasMatches = [...sqlQuery.matchAll(/\bAS\s+\[?([a-zA-ZæøåÆØÅ0-9_]+)\]?/gi)];
              const sqlAliaser   = aliasMatches.map(m => m[1]);
              console.log('[OpenAI] create_report SQL-aliaser:', sqlAliaser);
              if (sqlAliaser.length > 0 && !sqlAliaser.some(a => a.toLowerCase() === yAkseInput.toLowerCase())) {
                console.warn(`[OpenAI] create_report yAkse "${yAkseInput}" matcher ikke SQL-aliaser: ${sqlAliaser.join(', ')}`);
                result = {
                  error: `yAkse "${yAkseInput}" finnes ikke som alias i SQL. ` +
                    `Tilgjengelige aliaser: ${sqlAliaser.join(', ')}. ` +
                    `Bruk et av disse eksakt som yAkse. For KPI-kolonner: oppgi teknisk KPI-navn i kpi_referanser i stedet for å legge det i yAkse.`,
                };
                onChunk({ type: 'tool_call', tool: tc.name, result });
                history.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id });
                continue;
              }
            }

            let data: Record<string, unknown>[] = [];
            try {
              data = await queryAzureSQL(sqlQuery, 500);
              console.log('[OpenAI] create_report rader:', data.length);
            } catch (sqlErr) {
              console.error('[OpenAI] create_report SQL-feil:', sqlErr);
              result = { error: `SQL-feil: ${(sqlErr as Error).message}` };
              onChunk({ type: 'tool_call', tool: tc.name, result });
              history.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id });
              continue;
            }
            // Ekstraher viewnavn fra SQL for metadata-oppslag
            const viewMatch = sqlQuery.match(/\bFROM\s+(ai_gold\.\w+)/i);
            const viewNavn  = viewMatch?.[1] ?? null;

            // Hent ALLE kolonner fra viewet via INFORMATION_SCHEMA + LEFT JOIN metadata for kolonne_type
            let alleViewKolonner: { kolonne_navn: string; kolonne_type: string; sql_uttrykk?: string }[] = [];
            if (viewNavn) {
              const schemaName   = viewNavn.split('.')[0] ?? 'ai_gold';
              const viewNameOnly = viewNavn.split('.')[1] ?? viewNavn;
              const safeName     = viewNameOnly.replace(/'/g, "''");
              const safeSchema   = schemaName.replace(/'/g, "''");
              try {
                // INFORMATION_SCHEMA gir alltid ALLE kolonner; LEFT JOIN metadata for kuraterte typer
                const kolRader = await queryAzureSQL(`
                  SELECT
                    c.COLUMN_NAME as kolonne_navn,
                    COALESCE(
                      mk.kolonne_type,
                      CASE
                        WHEN c.DATA_TYPE IN ('int','bigint','smallint','tinyint','decimal',
                                             'numeric','float','real','money','smallmoney')
                        THEN 'measure'
                        WHEN c.DATA_TYPE IN ('date','datetime','datetime2',
                                             'smalldatetime','time','datetimeoffset')
                        THEN 'dato'
                        ELSE 'dimensjon'
                      END
                    ) as kolonne_type
                  FROM INFORMATION_SCHEMA.COLUMNS c
                  LEFT JOIN ai_metadata_views mv
                    ON mv.schema_name = '${safeSchema}'
                    AND mv.view_name  = '${safeName}'
                    AND mv.er_aktiv   = 1
                  LEFT JOIN ai_metadata_kolonner mk
                    ON mk.view_id      = mv.id
                    AND mk.kolonne_navn = c.COLUMN_NAME
                  WHERE c.TABLE_SCHEMA = '${safeSchema}'
                    AND c.TABLE_NAME   = '${safeName}'
                  ORDER BY c.ORDINAL_POSITION
                `);
                alleViewKolonner = kolRader
                  .map(r => ({
                    kolonne_navn: r['kolonne_navn'] as string,
                    kolonne_type: (r['kolonne_type'] as string) ?? 'dimensjon',
                  }))
                  .filter(k => Boolean(k.kolonne_navn));
                console.log('[OpenAI] create_report alle view-kolonner:', alleViewKolonner.length);

                // Hent KPI-er og legg til som virtuelle kolonner med sql_uttrykk
                // KPI-er finnes ikke i INFORMATION_SCHEMA — de er forhåndsdefinerte beregninger
                try {
                  const kpiRader = await queryAzureSQL(`
                    SELECT k.navn, k.visningsnavn, k.sql_uttrykk, k.format
                    FROM ai_metadata_kpi k
                    JOIN ai_metadata_views v ON k.view_id = v.id
                    WHERE v.schema_name = '${safeSchema}' AND v.view_name = '${safeName}'
                    AND v.er_aktiv = 1 AND k.er_aktiv = 1
                  `);
                  if (kpiRader.length > 0) {
                    const kpiKolonner = kpiRader
                      .filter(k => k['navn'] && k['sql_uttrykk'])
                      .map(k => ({
                        kolonne_navn: String(k['navn']),
                        kolonne_type: 'kpi' as string,
                        sql_uttrykk:  String(k['sql_uttrykk']),
                        visningsnavn: String(k['visningsnavn'] ?? k['navn']),
                        format:       k['format'] ? String(k['format']) : undefined,
                      }));
                    alleViewKolonner = [...alleViewKolonner, ...kpiKolonner];
                    console.log('[OpenAI] create_report KPI-er lastet:', kpiKolonner.length);
                  }
                } catch (kpiErr) {
                  console.warn('[OpenAI] create_report KPI-henting feilet:', (kpiErr as Error).message);
                }
              } catch (isErr) {
                console.warn('[OpenAI] create_report kolonner-feil:', (isErr as Error).message);
              }
            }

            // Hent prosjektfilter-definisjon fra metadata for dette viewet
            let prosjektKolonne: string | null = null;
            let prosjektKolonneType: string = 'number';
            let prosjektFilter: string | null = null;
            if (viewNavn) {
              const schemaNamePf   = viewNavn.split('.')[0] ?? 'ai_gold';
              const viewNameOnlyPf = viewNavn.split('.')[1] ?? viewNavn;
              try {
                const metaRader = await queryAzureSQL(`
                  SELECT prosjekt_kolonne, COALESCE(prosjekt_kolonne_type, 'number') as prosjekt_kolonne_type
                  FROM ai_metadata_views
                  WHERE schema_name = '${schemaNamePf.replace(/'/g, "''")}' AND view_name = '${viewNameOnlyPf.replace(/'/g, "''")}'
                  AND er_aktiv = 1
                `, 1);
                if (metaRader.length > 0 && metaRader[0]['prosjekt_kolonne']) {
                  prosjektKolonne     = metaRader[0]['prosjekt_kolonne'] as string;
                  prosjektKolonneType = (metaRader[0]['prosjekt_kolonne_type'] as string) ?? 'number';
                }
              } catch { /* ignorerer — prosjektfilter er valgfritt */ }
            }

            // Bygg prosjektfilter-klausul basert på kontekst
            const prosjektNr   = context?.prosjektNr ?? null;
            const prosjektNavn = context?.prosjektNavn ?? null;
            if (prosjektKolonne && (prosjektNr || prosjektNavn)) {
              const safKol = prosjektKolonne.replace(/[\[\]]/g, '');
              if (prosjektKolonneType === 'number' && prosjektNr) {
                prosjektFilter = `WHERE [${safKol}] = ${Number(prosjektNr)}`;
              } else if (prosjektKolonneType === 'string' && prosjektNr) {
                prosjektFilter = `WHERE [${safKol}] LIKE '%${prosjektNr.replace(/'/g, "''")}%'`;
              } else if (prosjektKolonneType === 'name' && prosjektNavn) {
                prosjektFilter = `WHERE [${safKol}] LIKE '%${prosjektNavn.replace(/'/g, "''")}%'`;
              }
            }
            console.log('[OpenAI] create_report prosjektfilter:', prosjektFilter ?? 'ingen');

            // Valider yAkse mot faktiske kolonner i SQL-resultatet
            const yAkseArg = args['yAkse'] as string | undefined;
            if (yAkseArg && data.length > 0) {
              const faktiskeKolonner = Object.keys(data[0]);
              const yAkseFinnes = faktiskeKolonner.some(
                k => k.toLowerCase() === yAkseArg.toLowerCase(),
              );
              if (!yAkseFinnes) {
                console.warn(`[OpenAI] create_report yAkse "${yAkseArg}" finnes ikke i SQL-resultatet. Faktiske kolonner: ${faktiskeKolonner.join(', ')}`);
                result = {
                  error: `Kolonnen "${yAkseArg}" finnes ikke i SQL-resultatet. ` +
                    `Faktiske kolonner er: ${faktiskeKolonner.join(', ')}. ` +
                    `Bruk et av disse eksakte navnene som yAkse — husk at alias i SQL MÅ matche originalnavnet fra viewet.`,
                };
                onChunk({ type: 'tool_call', tool: tc.name, result });
                history.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id });
                continue;
              }
            }

            const forslag: RapportForslag = {
              tittel:            args['tittel'] as string,
              beskrivelse:       args['beskrivelse'] as string | undefined,
              visualType:        args['visualType'] as string,
              xAkse:             args['xAkse'] as string | undefined,
              yAkse:             yAkseArg,
              grupperPaa:        args['grupperPaa'] as string | undefined,
              sql:               sqlQuery,
              data,
              foreslåSlicere:    args['foreslåSlicere'] as string[] | undefined,
              referanseLinje:    args['referanseLinje'] as { verdi: number; etikett?: string; farge?: string } | undefined ?? null,
              alleViewKolonner:  alleViewKolonner.length > 0 ? alleViewKolonner : undefined,
              viewNavn,
              prosjektNr,
              prosjektNavn,
              prosjektKolonne,
              prosjektKolonneType,
              prosjektFilter,
            };
            console.log('[OpenAI] create_report forslag klar, rader:', data.length);
            onChunk({ type: 'rapport_forslag', forslag });
            result = { success: true, message: `Rapportforslag "${forslag.tittel}" er klart med ${data.length} rader.` };
          }
        } else if (tc.name === 'opprett_kpi') {
          if (!context?.kanLageRapport) {
            result = { error: 'Du har ikke tilgang til å opprette KPI-er.' };
          } else {
            const viewNavn_     = String(args['view_navn'] ?? '');
            const navn_         = String(args['navn'] ?? '');
            const visningsnavn_ = String(args['visningsnavn'] ?? '');
            const sql_uttrykk_ = String(args['sql_uttrykk'] ?? '');
            const format_       = String(args['format'] ?? '');
            const beskrivelse_  = args['beskrivelse'] ? String(args['beskrivelse']) : '';

            if (!viewNavn_ || !navn_ || !visningsnavn_ || !sql_uttrykk_ || !format_) {
              result = { error: 'Mangler påkrevde felter: view_navn, navn, visningsnavn, sql_uttrykk, format. Tool-kallet ble avbrutt.' };
            } else {
              // Støtt både "ai_gold.vw_Foo" og bare "vw_Foo" (default schema ai_gold)
              const parts      = viewNavn_.includes('.') ? viewNavn_.split('.') : ['ai_gold', viewNavn_];
              const safeSchema = (parts[0] ?? 'ai_gold').replace(/'/g, "''");
              const safeView   = (parts[1] ?? viewNavn_).replace(/'/g, "''");
              const safeNavn   = navn_.replace(/'/g, "''");
              const safeVns    = visningsnavn_.replace(/'/g, "''");
              const safeSql    = sql_uttrykk_.replace(/'/g, "''");
              const safeFmt    = format_.replace(/'/g, "''");
              const safeBesk   = beskrivelse_.replace(/'/g, "''");

              // Slå opp view_id fra view-navn
              const viewRader = await queryAzureSQL(`
                SELECT id FROM ai_metadata_views
                WHERE schema_name = '${safeSchema}' AND view_name = '${safeView}' AND er_aktiv = 1
              `, 1);

              if (!viewRader.length) {
                result = { error: `View '${safeSchema}.${safeView}' er ikke registrert i metadata. Administrator må registrere viewet først.` };
              } else {
                const viewId = String(viewRader[0]['id']);

                // Sjekk om KPI med samme navn allerede eksisterer
                const eksisterende = await queryAzureSQL(`
                  SELECT id, navn, visningsnavn, sql_uttrykk, format, beskrivelse
                  FROM ai_metadata_kpi
                  WHERE view_id = '${viewId}' AND navn = '${safeNavn}'
                `, 1);

                if (eksisterende.length > 0) {
                  result = {
                    success: false,
                    duplikat: true,
                    kpi: eksisterende[0],
                    error: `KPI "${visningsnavn_}" finnes allerede (id: ${String(eksisterende[0]['id'])}). Ingen ny KPI ble opprettet.`,
                  };
                } else {
                  try {
                    const rows = await queryAzureSQL(`
                      INSERT INTO ai_metadata_kpi (view_id, navn, visningsnavn, sql_uttrykk, format, beskrivelse)
                      OUTPUT INSERTED.id, INSERTED.view_id, INSERTED.navn, INSERTED.visningsnavn,
                             INSERTED.sql_uttrykk, INSERTED.format, INSERTED.beskrivelse
                      VALUES (
                        '${viewId}', '${safeNavn}', '${safeVns}',
                        '${safeSql}', '${safeFmt}',
                        ${safeBesk ? `'${safeBesk}'` : 'NULL'}
                      )
                    `, 1);
                    // Logg for admin-oversikt (ikke kritisk — tabellen kan mangle)
                    queryAzureSQL(`
                      INSERT INTO ai_kpi_foresporsler (view_id, navn, bruker_id, status)
                      VALUES ('${viewId}', '${safeNavn}', '${(context?.entraObjectId ?? 'ukjent').replace(/'/g, "''")}', 'opprettet')
                    `).catch(() => {});
                    result = {
                      success: true,
                      kpi: rows[0],
                      melding: `KPI "${visningsnavn_}" er opprettet for ${safeSchema}.${safeView}. Administrator kan justere SQL-uttrykket i metadata-admin.`,
                    };
                  } catch (insertErr) {
                    const insertMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
                    result = {
                      success: false,
                      error: `KPI-insert feilet: ${insertMsg}. Ingen KPI ble opprettet.`,
                    };
                  }
                }
              }
            }
          }
        } else {
          result = { error: `Ukjent verktøy: ${tc.name}` };
        }
      } catch (err) {
        const e = err as { message?: string; status?: number; code?: string; type?: string };
        console.error('[OpenAI] Feil:', {
          message: e.message,
          status:  e.status,
          code:    e.code,
          type:    e.type,
        });
        result = { error: e.message ?? 'Ukjent feil' };
      }

      onChunk({ type: 'tool_call', tool: tc.name, result });

      history.push({
        role: 'tool',
        content: JSON.stringify(result),
        tool_call_id: tc.id,
      });
    }
  }

  const allMessages     = historyToMessages(history.slice(1));
  const frontendHistory = allMessages.filter(
    (m) => m.role === 'user' || (m.role === 'assistant' && !(m.tool_calls?.length)),
  );
  onChunk({ type: 'conversation_history', messages: frontendHistory });
  onChunk({ type: 'done' });
}
