/**
 * Test-script for pbiQueryService.utførDax.
 *
 * Tre scenarioer:
 *   1. Enkel TOPN — sanity check at datasett er nåbart
 *   2. SUMMARIZE — Hovedprosjekt → Prosjekt-mapping (hierarki-mønster)
 *   3. DISTINCT — Leverandører (basic-slicer-mønster) — kan være mange
 */

import 'dotenv/config';
import { utførDax, type DaxResultat } from '../src/services/pbiQueryService';

interface TestCase {
  navn:        string;
  workspaceId: string;
  datasetId:   string;
  dax:         string;
  visAntall:   number; // hvor mange rader å printe
}

const RESULTAT_WS = 'fba6eae4-4aaa-40ba-82a3-d08f4dea212d';
const RESULTAT_DS = 'e627bb29-dc52-40ee-a8c3-a6d4a930d2e6';
const LEV_WS      = '3d24f616-8ea3-4718-ac9f-78d612c67e46';
const LEV_DS      = 'cee82cb5-ff1d-44fd-aec8-588a46328b36';

const TESTER: TestCase[] = [
  {
    navn:        'Test 1: TOPN — sanity check',
    workspaceId: RESULTAT_WS,
    datasetId:   RESULTAT_DS,
    dax:         "EVALUATE TOPN(5, 'Dim_Prosjekt_LNS')",
    visAntall:   1,
  },
  {
    navn:        'Test 2: SUMMARIZE — Hovedprosjekt-hierarki',
    workspaceId: RESULTAT_WS,
    datasetId:   RESULTAT_DS,
    dax:
      `EVALUATE
SUMMARIZE(
  'Dim_Prosjekt_LNS',
  'Dim_Prosjekt_LNS'[Hovedprosjekt],
  'Dim_Prosjekt_LNS'[Prosjekt]
)
ORDER BY [Hovedprosjekt], [Prosjekt]`,
    visAntall: 5,
  },
  {
    navn:        'Test 3: DISTINCT — Leverandører (basic-mønster)',
    workspaceId: LEV_WS,
    datasetId:   LEV_DS,
    dax:
      `EVALUATE
DISTINCT('core Dim_Supplier_LNS'[LevNavn])
ORDER BY [LevNavn]`,
    visAntall: 10,
  },
];

function visRader(rader: Array<Record<string, unknown>>, antall: number): void {
  const utvalg = rader.slice(0, antall);
  for (const [i, rad] of utvalg.entries()) {
    console.log(`    ${i + 1}. ${JSON.stringify(rad)}`);
  }
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('TEST — Power BI DAX-tjeneste');
  console.log('═══════════════════════════════════════════════════');

  let alleOk = true;

  for (const test of TESTER) {
    console.log(`\n${test.navn}`);
    console.log(`  ws=${test.workspaceId} ds=${test.datasetId}`);

    let resultat: DaxResultat;
    try {
      resultat = await utførDax({
        workspaceId: test.workspaceId,
        datasetId:   test.datasetId,
        dax:         test.dax,
      });
    } catch (err) {
      alleOk = false;
      console.log(`  [✗] FEIL: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const kolonner = resultat.rader.length > 0 ? Object.keys(resultat.rader[0]) : [];
    console.log(`  [✓] ${resultat.rader.length} rader på ${resultat.spørringMs}ms`);
    console.log(`      Kolonner: ${kolonner.join(', ')}`);
    console.log(`      Første ${Math.min(test.visAntall, resultat.rader.length)} rader:`);
    visRader(resultat.rader, test.visAntall);
  }

  console.log('\n───────────────────────────────────────────────────');
  console.log(alleOk
    ? '✓ Alle DAX-tester grønne'
    : '✗ Minst én DAX-test feilet');
  console.log('───────────────────────────────────────────────────\n');

  if (!alleOk) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
