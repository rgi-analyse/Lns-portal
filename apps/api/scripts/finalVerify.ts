import 'dotenv/config';
import { queryAzureSQL } from '../src/services/azureSqlService';

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║     AI Metadata-katalog — Final verifisering     ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // 1. Tabeller
  const tabeller = await queryAzureSQL(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE 'ai_metadata%' ORDER BY TABLE_NAME
  `);
  console.log(`✓ Tabeller (${tabeller.length}/4 forventet):`);
  tabeller.forEach(t => console.log(`    ${t['TABLE_NAME']}`));

  // 2. Views + kolonner
  const views = await queryAzureSQL(`
    SELECT v.schema_name, v.view_name, v.visningsnavn, v.område,
           COUNT(k.id) as antall_kolonner,
           COUNT(DISTINCT r.id) as antall_regler,
           COUNT(DISTINCT e.id) as antall_eksempler,
           v.sist_synkronisert
    FROM ai_metadata_views v
    LEFT JOIN ai_metadata_kolonner k ON k.view_id = v.id
    LEFT JOIN ai_metadata_regler r ON r.view_id = v.id
    LEFT JOIN ai_metadata_eksempler e ON e.view_id = v.id
    WHERE v.er_aktiv = 1
    GROUP BY v.id, v.schema_name, v.view_name, v.visningsnavn, v.område, v.sist_synkronisert
    ORDER BY v.område, v.view_name
  `);
  console.log(`\n✓ Views (${views.length}/4 forventet):`);
  views.forEach(v => {
    const synk = v['sist_synkronisert'] ? new Date(v['sist_synkronisert'] as string).toLocaleString('nb-NO') : 'ikke synkronisert';
    console.log(`    ${v['schema_name']}.${v['view_name']}`);
    console.log(`      [${v['område']}] ${v['visningsnavn']}`);
    console.log(`      Kolonner: ${v['antall_kolonner']}, Regler: ${v['antall_regler']}, Eksempler: ${v['antall_eksempler']}`);
    console.log(`      Synkronisert: ${synk}`);
  });

  // 3. RUH-regler
  const regler = await queryAzureSQL(`
    SELECT r.regel
    FROM ai_metadata_regler r
    JOIN ai_metadata_views v ON r.view_id = v.id
    WHERE v.view_name = 'vw_Fact_RUH'
    ORDER BY r.regel
  `);
  console.log(`\n✓ Regler for vw_Fact_RUH (${regler.length}/4 forventet):`);
  regler.forEach(r => console.log(`    • ${r['regel']}`));

  // 4. Eksempelverdier auto-populated
  const eksVerdier = await queryAzureSQL(`
    SELECT TOP 5 k.kolonne_navn, LEFT(k.eksempel_verdier, 80) as eksempel_verdier
    FROM ai_metadata_kolonner k
    JOIN ai_metadata_views v ON k.view_id = v.id
    WHERE v.view_name = 'vw_Fact_RUH'
      AND k.eksempel_verdier IS NOT NULL
    ORDER BY k.sort_order
  `);
  console.log(`\n✓ Eksempelverdier auto-populert for vw_Fact_RUH (topp 5):`);
  eksVerdier.forEach(k => console.log(`    ${k['kolonne_navn']}: ${k['eksempel_verdier']}…`));

  // 5. Nye views i ai_gold
  const nyeViews = await queryAzureSQL(`
    SELECT v.TABLE_SCHEMA as schema_name, v.TABLE_NAME as view_name
    FROM INFORMATION_SCHEMA.VIEWS v
    WHERE v.TABLE_SCHEMA = 'ai_gold'
      AND NOT EXISTS (
        SELECT 1 FROM ai_metadata_views m
        WHERE m.schema_name = v.TABLE_SCHEMA AND m.view_name = v.TABLE_NAME
      )
    ORDER BY v.TABLE_NAME
  `);
  if (nyeViews.length > 0) {
    console.log(`\n⚠  ${nyeViews.length} nye views i ai_gold (ikke i katalogen):`);
    nyeViews.forEach(v => console.log(`    ${v['schema_name']}.${v['view_name']}`));
  } else {
    console.log('\n✓ Alle ai_gold-views er registrert i katalogen.');
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('API-endepunkter tilgjengelig:');
  console.log('  GET  /api/admin/metadata/views');
  console.log('  GET  /api/admin/metadata/views/:id');
  console.log('  POST /api/admin/metadata/views');
  console.log('  PUT  /api/admin/metadata/views/:id');
  console.log('  DEL  /api/admin/metadata/views/:id');
  console.log('  POST /api/admin/metadata/views/:id/sync');
  console.log('  POST /api/admin/metadata/sync-all');
  console.log('  GET  /api/admin/metadata/discover');
  console.log('  PUT  /api/admin/metadata/views/:id/kolonner/:kolId');
  console.log('  POST /api/admin/metadata/views/:id/eksempler');
  console.log('  DEL  /api/admin/metadata/views/:id/eksempler/:eksId');
  console.log('  POST /api/admin/metadata/views/:id/regler');
  console.log('  DEL  /api/admin/metadata/views/:id/regler/:regelId');
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch(err => { console.error('Feil:', err.message); process.exit(1); });
