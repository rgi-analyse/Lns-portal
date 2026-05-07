/**
 * Diagnose-script: AI Search + Power BI executeQueries.
 *
 * Verifiserer at vi kan:
 *   1. Koble til Azure AI Search med admin-key, liste indekser, opprette og slette
 *   2. Kjøre DAX mot Power BI executeQueries med vår eksisterende Service Principal
 *
 * Kjøres lokalt: npx tsx scripts/diagnoseSearch.ts (fra apps/api)
 */

import 'dotenv/config';
import { SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';
import { getAzureToken } from '../src/lib/azureToken';

const TEST_INDEX_NAME  = `diagnose-test-${Date.now()}`;
const PBI_WORKSPACE_ID = 'fba6eae4-4aaa-40ba-82a3-d08f4dea212d';
const PBI_DATASET_ID   = 'e627bb29-dc52-40ee-a8c3-a6d4a930d2e6';
const TEST_DAX         = "EVALUATE TOPN(1, 'Dim_Prosjekt_LNS')";

interface CheckResult {
  name:     string;
  ok:       boolean;
  detail?:  string;
}

function feilTekst(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

async function testAiSearch(): Promise<CheckResult[]> {
  const r: CheckResult[] = [];

  r.push({ name: 'Pakke @azure/search-documents installert', ok: true });

  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const adminKey = process.env.AZURE_SEARCH_ADMIN_KEY;

  if (!endpoint || !adminKey) {
    r.push({
      name: 'Env-variabler satt',
      ok:   false,
      detail:
        `endpoint=${endpoint ? '(satt)' : '(MANGLER)'}, ` +
        `adminKey=${adminKey ? '(satt)' : '(MANGLER)'}`,
    });
    return r;
  }
  r.push({ name: 'Env-variabler satt', ok: true, detail: `endpoint=${endpoint}` });

  let client: SearchIndexClient;
  try {
    client = new SearchIndexClient(endpoint, new AzureKeyCredential(adminKey));
    r.push({ name: 'Klient opprettet', ok: true });
  } catch (err) {
    r.push({ name: 'Klient opprettet', ok: false, detail: feilTekst(err) });
    return r;
  }

  // Listing
  try {
    const navn: string[] = [];
    for await (const ix of client.listIndexes()) navn.push(ix.name);
    r.push({
      name: 'Klient kan koble (listIndexes)',
      ok: true,
      detail: `${navn.length} eksisterende indekser: ${navn.join(', ') || '(ingen)'}`,
    });
  } catch (err) {
    r.push({ name: 'Klient kan koble (listIndexes)', ok: false, detail: feilTekst(err) });
    return r;
  }

  // Opprett test-indeks
  let opprettetOk = false;
  try {
    await client.createIndex({
      name: TEST_INDEX_NAME,
      fields: [
        { name: 'id',    type: 'Edm.String', key: true,                  filterable: true },
        { name: 'tekst', type: 'Edm.String', searchable: true,           filterable: false },
      ],
    });
    r.push({ name: 'Kan opprette indeks', ok: true, detail: `opprettet: ${TEST_INDEX_NAME}` });
    opprettetOk = true;
  } catch (err) {
    r.push({ name: 'Kan opprette indeks', ok: false, detail: feilTekst(err) });
  }

  // Slett test-indeks (bare hvis vi opprettet den)
  if (opprettetOk) {
    try {
      await client.deleteIndex(TEST_INDEX_NAME);
      r.push({ name: 'Kan slette indeks', ok: true });
    } catch (err) {
      r.push({
        name: 'Kan slette indeks',
        ok: false,
        detail: `Indeks "${TEST_INDEX_NAME}" må slettes manuelt. ${feilTekst(err)}`,
      });
    }
  }

  return r;
}

async function testPbiExecuteQueries(): Promise<CheckResult[]> {
  const r: CheckResult[] = [];

  const tenantId     = process.env.PBI_TENANT_ID;
  const clientId     = process.env.PBI_CLIENT_ID;
  const clientSecret = process.env.PBI_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    r.push({
      name: 'PBI Service Principal env-variabler satt',
      ok: false,
      detail:
        `tenant=${tenantId ? '(satt)' : '(MANGLER)'}, ` +
        `client=${clientId ? '(satt)' : '(MANGLER)'}, ` +
        `secret=${clientSecret ? '(satt)' : '(MANGLER)'}`,
    });
    return r;
  }
  r.push({ name: 'PBI Service Principal env-variabler satt', ok: true });

  let token: string;
  try {
    token = await getAzureToken(tenantId, clientId, clientSecret);
    r.push({ name: 'Service Principal token hentet', ok: true });
  } catch (err) {
    r.push({ name: 'Service Principal token hentet', ok: false, detail: feilTekst(err) });
    return r;
  }

  const url = `https://api.powerbi.com/v1.0/myorg/groups/${PBI_WORKSPACE_ID}/datasets/${PBI_DATASET_ID}/executeQueries`;
  const body = {
    queries: [{ query: TEST_DAX }],
    serializerSettings: { includeNulls: true },
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    r.push({ name: 'executeQueries POST', ok: false, detail: feilTekst(err) });
    return r;
  }

  const respText = await response.text();

  if (response.status === 200) {
    let førsteRad: unknown = null;
    try {
      const parsed = JSON.parse(respText) as {
        results?: Array<{ tables?: Array<{ rows?: unknown[] }> }>;
      };
      førsteRad = parsed.results?.[0]?.tables?.[0]?.rows?.[0] ?? null;
    } catch { /* ignorer parsefeil — body var ikke JSON */ }

    r.push({ name: 'Service Principal har tilgang (200 OK)', ok: true });
    r.push({
      name: 'DAX kjører mot datasett',
      ok: true,
      detail: `Query: ${TEST_DAX}`,
    });
    r.push({
      name: 'Returnerer forventet data',
      ok: !!førsteRad,
      detail: førsteRad
        ? `Første rad: ${JSON.stringify(førsteRad)}`
        : 'Ingen rader i respons',
    });
  } else if (response.status === 401) {
    r.push({
      name: 'Service Principal har tilgang',
      ok: false,
      detail: `401 Unauthorized — token feil eller utløpt. Body: ${respText.slice(0, 500)}`,
    });
  } else if (response.status === 403) {
    r.push({
      name: 'Service Principal har tilgang',
      ok: false,
      detail:
        `403 Forbidden — sannsynlig at "Dataset Execute Queries REST API" er AV ` +
        `i tenant settings, ELLER at SP mangler "Build" på datasettet/workspacet. ` +
        `Body: ${respText.slice(0, 500)}`,
    });
  } else if (response.status === 429) {
    r.push({
      name: 'Service Principal har tilgang',
      ok: false,
      detail: `429 Rate limit. Body: ${respText.slice(0, 500)}`,
    });
  } else {
    r.push({
      name: 'executeQueries respons',
      ok: false,
      detail: `HTTP ${response.status}. Body: ${respText.slice(0, 500)}`,
    });
  }

  return r;
}

function skrivUt(seksjon: string, results: CheckResult[]): void {
  console.log(`\n${seksjon}:`);
  for (const r of results) {
    console.log(`  [${r.ok ? '✓' : '✗'}] ${r.name}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('DIAGNOSE — AI Search + PBI executeQueries');
  console.log('═══════════════════════════════════════════════════');

  const search = await testAiSearch();
  skrivUt('AI Search', search);

  const pbi = await testPbiExecuteQueries();
  skrivUt('Power BI executeQueries', pbi);

  const alle = [...search, ...pbi];
  const alleOk = alle.every((r) => r.ok);

  console.log('\n───────────────────────────────────────────────────');
  console.log(alleOk
    ? '✓ Alle sjekker grønne — klar for implementasjon'
    : `✗ ${alle.filter((r) => !r.ok).length} sjekker feilet — fiks før implementasjon`);
  console.log('───────────────────────────────────────────────────\n');

  if (!alleOk) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
