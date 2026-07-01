/**
 * Standalone KQL-test mot ekte Eventhouse. Verifiserer at PBI-service-principal
 * har Viewer-tilgang og at spørrings-stien fungerer FØR vi bygger API-ruter.
 *
 * Kjør:
 *   cd apps/api
 *   npx tsx src/scripts/testKql.ts
 *
 * Krever i .env: KUSTO_CLUSTER_URI, KUSTO_DATABASE (eh_Skaland),
 *                PBI_TENANT_ID / PBI_CLIENT_ID / PBI_CLIENT_SECRET
 */
import 'dotenv/config';
import { kjørDiagnoseKql, hentSensorData } from '../services/kustoService';

const TABELL = 'SensorFlake1';
const VERDI_FELT = 'fill_grade_percentage';
const SID = 'e6284176-355d-4e1c-b4e5-53dacb998d13'; // Flake 1

let feil = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const nei = (m: string) => { feil++; console.log(`  ✗ ${m}`); };

async function main(): Promise<void> {
  console.log(`KUSTO_CLUSTER_URI=${process.env.KUSTO_CLUSTER_URI ?? '(mangler)'}  KUSTO_DATABASE=${process.env.KUSTO_DATABASE ?? '(mangler)'}\n`);

  // 1) Connection + skjema
  console.log('1) Connection + skjema for SensorFlake1:');
  const skjema = await kjørDiagnoseKql(`${TABELL} | getschema | project ColumnName, ColumnType`);
  console.table(skjema);
  ok(`connect OK (${skjema.length} kolonner)`);

  // 2) Parametrisert query: sid + siden=ago(5m)
  console.log('\n2) Parametrisert hentSensorData (siden = ago(5m)):');
  const siden5m = new Date(Date.now() - 5 * 60 * 1000);
  const punkter = await hentSensorData({ kqlTabell: TABELL, kqlVerdiFelt: VERDI_FELT, kqlSensorId: SID, siden: siden5m });
  console.log(`   ${punkter.length} punkter. Første 3 / siste 1:`);
  console.table([...punkter.slice(0, 3), ...(punkter.length > 3 ? [punkter[punkter.length - 1]] : [])]);
  punkter.length > 0 ? ok(`returnerte ${punkter.length} punkter`) : nei('0 punkter (ingen data siste 5 min?)');

  // 3) Regex-validering blokkerer ugyldige identifiers (før nettverk)
  console.log('\n3) Regex-validering blokkerer ugyldige tabell-/feltnavn:');
  for (const [felt, verdi] of [['kqlTabell', 'SensorFlake1; drop table x'], ['kqlVerdiFelt', 'fill grade']] as const) {
    try {
      await hentSensorData({ kqlTabell: felt === 'kqlTabell' ? verdi : TABELL, kqlVerdiFelt: felt === 'kqlVerdiFelt' ? verdi : VERDI_FELT, kqlSensorId: SID, siden: siden5m });
      nei(`ugyldig ${felt}="${verdi}" ble IKKE blokkert`);
    } catch (e) {
      /Ugyldig KQL-identifier/.test(String(e instanceof Error ? e.message : e))
        ? ok(`ugyldig ${felt} blokkert`)
        : nei(`${felt} kastet feil melding: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 4) Delta-fetch: siden = siste mottatte timestamp → skal gi kun nyere punkter
  console.log('\n4) Delta-fetch (siden = siste timestamp fra steg 2):');
  if (punkter.length > 0) {
    const sisteTs = new Date(punkter[punkter.length - 1]!.ts);
    const delta = await hentSensorData({ kqlTabell: TABELL, kqlVerdiFelt: VERDI_FELT, kqlSensorId: SID, siden: sisteTs });
    console.log(`   delta returnerte ${delta.length} punkter (alle > ${sisteTs.toISOString()})`);
    const alleNyere = delta.every(p => new Date(p.ts) > sisteTs);
    alleNyere ? ok('delta inneholder kun nyere punkter') : nei('delta inneholdt punkter <= siste timestamp');
  } else {
    console.log('   hoppet over (ingen punkter fra steg 2)');
  }

  console.log(feil === 0 ? '\nALLE SJEKKER OK' : `\n${feil} SJEKK(ER) FEILET`);
}

main().then(() => process.exit(feil === 0 ? 0 : 1)).catch((err) => {
  console.error('\nFEIL (uventet):', err instanceof Error ? err.message : err);
  process.exit(1);
});
