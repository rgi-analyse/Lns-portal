import 'dotenv/config';
import * as sql from 'mssql';

const raw = process.env.DATABASE_URL ?? '';
const wp = raw.replace('sqlserver://', '');
const [hp, ...ps] = wp.split(';');
const [host, portStr] = hp.split(':');
const params: Record<string, string> = {};
ps.forEach(p => { const [k, ...r] = p.split('='); if (k && r.length) params[k.toLowerCase()] = r.join('='); });

const config: sql.config = {
  server: host, port: parseInt(portStr || '1433'),
  database: params['database'], user: params['user'],
  password: params['password'], options: { encrypt: true, trustServerCertificate: false },
};

async function main() {
  const pool = await sql.connect(config);

  // Vis duplikater
  const before = await pool.request().query(`
    SELECT r.regel, COUNT(*) as antall
    FROM ai_metadata_regler r
    JOIN ai_metadata_views v ON r.view_id = v.id
    WHERE v.view_name = 'vw_Fact_RUH'
    GROUP BY r.regel
    ORDER BY antall DESC, r.regel
  `);
  console.log('Regler før opprydding:');
  (before.recordset as { regel: string; antall: number }[]).forEach(r =>
    console.log(`  [${r.antall}x] ${r.regel.substring(0, 70)}`),
  );

  // Slett duplikater — behold kun én av hvert
  const dedup = await pool.request().query(`
    WITH ranked AS (
      SELECT r.id, r.regel,
             ROW_NUMBER() OVER (PARTITION BY r.view_id, r.regel ORDER BY r.id) AS rn
      FROM ai_metadata_regler r
      JOIN ai_metadata_views v ON r.view_id = v.id
      WHERE v.view_name = 'vw_Fact_RUH'
    )
    DELETE FROM ai_metadata_regler
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
  `);
  console.log(`\nSlettet ${dedup.rowsAffected[0]} duplikater.`);

  // Vis etter opprydding
  const after = await pool.request().query(`
    SELECT r.regel
    FROM ai_metadata_regler r
    JOIN ai_metadata_views v ON r.view_id = v.id
    WHERE v.view_name = 'vw_Fact_RUH'
    ORDER BY r.regel
  `);
  console.log(`\nRegler etter opprydding (${after.recordset.length} stk):`);
  (after.recordset as { regel: string }[]).forEach(r => console.log(`  ✓ ${r.regel}`));

  await pool.close();
}

main().catch(err => { console.error(err); process.exit(1); });
