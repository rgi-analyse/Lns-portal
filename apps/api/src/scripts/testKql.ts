/**
 * Standalone KQL-test mot ekte Eventhouse. Verifiserer at PBI-service-principal
 * har Viewer-tilgang og at spørrings-stien fungerer FØR vi bygger API-ruter.
 *
 * Kjør:
 *   cd apps/api
 *   npx tsx src/scripts/testKql.ts
 *
 * Krever i .env:
 *   KUSTO_CLUSTER_URI   (Eventhouse query-URI)
 *   KUSTO_DATABASE      = eh_Skaland
 *   PBI_TENANT_ID / PBI_CLIENT_ID / PBI_CLIENT_SECRET
 * Valgfritt (for full hentSensorData-test):
 *   TEST_SENSOR_ID      (velg fra distinct-lista under)
 *   TEST_VERDI_FELT     (verdi-kolonnen fra getschema, f.eks. fill_grade_percentage)
 */
import 'dotenv/config';
import { kjørDiagnoseKql, hentSensorData } from '../services/kustoService';

const TABELL = 'SensorFlake1';

async function main(): Promise<void> {
  console.log(`KUSTO_CLUSTER_URI=${process.env.KUSTO_CLUSTER_URI ?? '(mangler)'}  KUSTO_DATABASE=${process.env.KUSTO_DATABASE ?? '(mangler)'}`);

  console.log(`\n1) Skjema for ${TABELL} (finn verdi-kolonnen):`);
  console.table(await kjørDiagnoseKql(`${TABELL} | getschema | project ColumnName, ColumnType`));

  console.log(`\n2) Distinct SensorID (topp 20 — velg én til TEST_SENSOR_ID):`);
  console.table(await kjørDiagnoseKql(`${TABELL} | distinct SensorID | take 20`));

  const sid = process.env.TEST_SENSOR_ID;
  const felt = process.env.TEST_VERDI_FELT;
  if (!sid || !felt) {
    console.log('\n3) Sett TEST_SENSOR_ID + TEST_VERDI_FELT i .env og kjør igjen for full hentSensorData-test.');
    return;
  }

  const siden = new Date(Date.now() - 30 * 60 * 1000);
  console.log(`\n3) hentSensorData(${TABELL}, felt=${felt}, SensorID=${sid}, siden=${siden.toISOString()}):`);
  const punkter = await hentSensorData({ kqlTabell: TABELL, kqlVerdiFelt: felt, kqlSensorId: sid, siden });
  console.log(`   OK: ${punkter.length} punkter. Første 5:`);
  console.table(punkter.slice(0, 5));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nFEIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
