import 'dotenv/config';
import { syncAllViews, discoverNewViews } from '../src/services/metadataSync';
import { queryAzureSQL } from '../src/services/azureSqlService';

async function main() {
  console.log('\n=== Test: syncAllViews ===\n');
  const results = await syncAllViews();
  console.log('\nResultat:');
  results.forEach(r => console.log(`  ${r.view}: ${r.kolonner} kolonner, ${r.eksempelVerdier} med eksempelverdier`));

  console.log('\n=== Test: discoverNewViews ===\n');
  const nye = await discoverNewViews();
  if (nye.length === 0) {
    console.log('Ingen nye views funnet (alle er allerede registrert).');
  } else {
    console.log(`${nye.length} nye views funnet:`);
    nye.forEach(v => console.log(`  ${v.schema_name}.${v.view_name}`));
  }

  console.log('\n=== Verifisering: kolonner per view ===\n');
  const kolonner = await queryAzureSQL(`
    SELECT v.view_name, COUNT(k.id) as antall_kolonner
    FROM ai_metadata_views v
    LEFT JOIN ai_metadata_kolonner k ON k.view_id = v.id
    GROUP BY v.view_name
    ORDER BY v.view_name
  `);
  kolonner.forEach(r => console.log(`  ${r['view_name']}: ${r['antall_kolonner']} kolonner`));

  console.log('\n=== Sample: topp 5 kolonner for vw_Fact_RUH ===\n');
  const ruhKolonner = await queryAzureSQL(`
    SELECT k.kolonne_navn, k.datatype, k.eksempel_verdier
    FROM ai_metadata_kolonner k
    JOIN ai_metadata_views v ON k.view_id = v.id
    WHERE v.view_name = 'vw_Fact_RUH'
    ORDER BY k.sort_order
  `, 20);
  ruhKolonner.forEach(k => {
    const eks = k['eksempel_verdier'] ? ` → [${k['eksempel_verdier']}]` : '';
    console.log(`  ${k['kolonne_navn']} (${k['datatype']})${eks}`);
  });
}

main().catch(err => {
  console.error('Feil:', err);
  process.exit(1);
});
