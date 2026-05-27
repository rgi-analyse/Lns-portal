/**
 * Wrapper rundt Power BI executeQueries REST API.
 *
 * Brukes til å kjøre DAX mot Power BI-datasett for å hente slicer-verdier
 * som senere indekseres i Azure AI Search.
 *
 * Auth: PBI Service Principal (PBI_TENANT_ID/CLIENT_ID/CLIENT_SECRET).
 *
 * Begrensninger (Microsoft):
 *   - 100 000 rader / 1 000 000 verdier / 15 MB per query (først truffet vinner)
 *   - 120 queries/min per Service Principal
 *   - Én query per kall, én tabell per query
 *   - Ikke støttet med RLS-aktiverte datasett (vil gi 401/403)
 */

import { getAzureToken } from '../lib/azureToken';

export interface DaxParametere {
  workspaceId: string;
  datasetId:   string;
  dax:         string;
}

export interface DaxResultat {
  rader:       Array<Record<string, unknown>>;
  spørringMs:  number;
}

interface PbiExecuteQueriesRespons {
  results?: Array<{
    tables?: Array<{ rows?: Array<Record<string, unknown>> }>;
    error?:  { code?: string; message?: string };
  }>;
  error?: { code?: string; message?: string };
}

class PbiDaxFeil extends Error {
  constructor(
    public readonly status:    number,
    public readonly daxQuery:  string,
    public readonly detail:    string,
    melding?: string,
  ) {
    super(melding ?? `PBI DAX feilet (HTTP ${status}): ${detail}`);
    this.name = 'PbiDaxFeil';
  }
}

/**
 * Kjør én DAX-spørring mot et Power BI-datasett.
 *
 * Throw'er PbiDaxFeil med tydelig melding ved 400/401/403/429/5xx.
 * Returnerer rader + spørrings-tid i ms ved 200.
 */
export async function utførDax(parametere: DaxParametere): Promise<DaxResultat> {
  const tenantId     = process.env.PBI_TENANT_ID;
  const clientId     = process.env.PBI_CLIENT_ID;
  const clientSecret = process.env.PBI_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('PBI Service Principal env-variabler mangler (PBI_TENANT_ID/CLIENT_ID/CLIENT_SECRET).');
  }

  const t0 = Date.now();
  console.log(`[pbi-dax] start ws=${parametere.workspaceId} ds=${parametere.datasetId} (${parametere.dax.length} chars)`);

  const token = await getAzureToken(tenantId, clientId, clientSecret);

  const url = `https://api.powerbi.com/v1.0/myorg/groups/${parametere.workspaceId}/datasets/${parametere.datasetId}/executeQueries`;
  const body = {
    queries: [{ query: parametere.dax }],
    serializerSettings: { includeNulls: true },
  };

  const respons = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const respText = await respons.text();

  if (!respons.ok) {
    const detail = respText.slice(0, 800);
    let melding = `PBI svarte HTTP ${respons.status}`;
    if (respons.status === 400)      melding = `Ugyldig DAX-syntaks. Detail: ${detail}`;
    else if (respons.status === 401) melding = `Token avvist (401). Detail: ${detail}`;
    else if (respons.status === 403) melding = `Service Principal mangler tilgang til datasett ${parametere.datasetId} (403). Sjekk workspace-medlemskap og tenant setting "Dataset Execute Queries REST API". Detail: ${detail}`;
    else if (respons.status === 429) melding = `Rate limit (429) — 120 queries/min per SP overskredet. Detail: ${detail}`;
    console.error(`[pbi-dax] feil ${respons.status}: ${detail}`);
    throw new PbiDaxFeil(respons.status, parametere.dax, detail, melding);
  }

  let parsed: PbiExecuteQueriesRespons;
  try {
    parsed = JSON.parse(respText) as PbiExecuteQueriesRespons;
  } catch (err) {
    throw new PbiDaxFeil(200, parametere.dax, respText.slice(0, 500),
      `Kunne ikke parse JSON-respons: ${err instanceof Error ? err.message : 'ukjent'}`);
  }

  const førsteResult = parsed.results?.[0];
  if (førsteResult?.error) {
    const detail = `${førsteResult.error.code ?? ''} — ${førsteResult.error.message ?? ''}`;
    throw new PbiDaxFeil(200, parametere.dax, detail, `DAX-feil i respons: ${detail}`);
  }

  const rader = førsteResult?.tables?.[0]?.rows ?? [];
  const spørringMs = Date.now() - t0;
  console.log(`[pbi-dax] ferdig ${rader.length} rader på ${spørringMs}ms`);

  return { rader, spørringMs };
}

/**
 * Lister tabeller i et PBI-datasett via Power BI REST API.
 *
 * Brukes som fallback når INFO.TABLES via executeQueries feiler (eldre
 * datasett / tabular models som ikke støtter INFO-funksjonene).
 *
 * NB: REST-endepunktet inkluderer ALLE tabeller (også IsHidden=TRUE) — kaller
 * må evt. filtrere selv. Endepunktet er offisielt Microsoft og krever samme
 * SP-rettigheter som utførDax (Dataset.Read.All + workspace-medlemskap).
 */
export async function hentTabellerViaREST(
  workspaceId: string,
  datasetId:   string,
): Promise<string[]> {
  console.log(`[pbi-rest] hentTabellerViaREST starter ws=${workspaceId} ds=${datasetId}`);

  const tenantId     = process.env.PBI_TENANT_ID;
  const clientId     = process.env.PBI_CLIENT_ID;
  const clientSecret = process.env.PBI_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    console.error('[pbi-rest] env-variabler mangler', {
      hasTenantId: !!tenantId, hasClientId: !!clientId, hasClientSecret: !!clientSecret,
    });
    throw new Error('PBI Service Principal env-variabler mangler.');
  }

  console.log('[pbi-rest] henter token...');
  let token: string;
  try {
    token = await getAzureToken(tenantId, clientId, clientSecret);
    console.log(`[pbi-rest] token OK (length=${token.length})`);
  } catch (err) {
    console.error('[pbi-rest] token-utveksling feilet:', err);
    throw err;
  }

  const url = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/tables`;
  console.log(`[pbi-rest] GET ${url}`);

  let respons: Response;
  try {
    respons = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error(`[pbi-rest] nettverk-feil ved fetch:`, err);
    throw err;
  }

  if (!respons.ok) {
    const body = await respons.text();
    const detail = body.slice(0, 500);
    console.error(`[pbi-rest] HTTP ${respons.status} ${respons.statusText} — body: ${detail}`);
    throw new PbiDaxFeil(
      respons.status,
      `GET ${url}`,
      detail,
      `PBI REST /tables HTTP ${respons.status}: ${detail}`,
    );
  }

  let json: { value?: Array<{ name?: string }> };
  try {
    json = await respons.json() as { value?: Array<{ name?: string }> };
  } catch (err) {
    console.error('[pbi-rest] kunne ikke parse JSON-respons:', err);
    throw err;
  }

  const tabeller = (json.value ?? [])
    .map((t) => t.name ?? '')
    .filter((navn) => navn.length > 0);
  console.log(`[pbi-rest] suksess: ${tabeller.length} tabeller (av ${json.value?.length ?? 0} rader)`);
  return tabeller;
}
