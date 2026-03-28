import 'dotenv/config';
import * as sql from 'mssql';
import * as fs from 'fs';
import * as path from 'path';

const raw = process.env.DATABASE_URL ?? '';
const withoutProtocol = raw.replace('sqlserver://', '');
const [hostPort, ...paramParts] = withoutProtocol.split(';');
const [host, portStr] = hostPort.split(':');
const params: Record<string, string> = {};
paramParts.forEach(part => {
  const [key, ...rest] = part.split('=');
  if (key && rest.length) params[key.toLowerCase()] = rest.join('=');
});

const config: sql.config = {
  server: host,
  port: portStr ? parseInt(portStr) : 1433,
  database: params['database'] || params['initial catalog'],
  user: params['user'] || params['user id'] || params['uid'],
  password: params['password'] || params['pwd'],
  options: { encrypt: true, trustServerCertificate: false },
};

async function run() {
  console.log(`\nKobler til ${config.server}/${config.database}…`);
  const pool = await sql.connect(config);
  console.log('Tilkoblet.\n');

  const sqlFile = path.join(__dirname, '..', 'sql', '001_ai_metadata.sql');
  const content = fs.readFileSync(sqlFile, 'utf8');

  // Del på GO-setninger (T-SQL batch-separator)
  // Filtrer kun helt tomme batches — behold batches som starter med kommentarer
  const batches = content
    .split(/^\s*GO\s*$/im)
    .map(b => b.trim())
    .filter(b => b.replace(/--[^\n]*/g, '').trim().length > 0);

  console.log(`Kjører ${batches.length} SQL-batches…\n`);

  let ok = 0;
  let skipped = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const preview = batch.substring(0, 80).replace(/\n/g, ' ');
    try {
      await pool.request().query(batch);
      console.log(`[OK ${i + 1}] ${preview}…`);
      ok++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Ignorer "already exists"-feil (idempotent kjøring)
      if (msg.includes('already exists') || msg.includes('There is already') || msg.includes('duplicate key')) {
        console.log(`[SKIP ${i + 1}] Eksisterer allerede — ${preview.substring(0, 60)}…`);
        skipped++;
      } else {
        console.error(`[FEIL ${i + 1}] ${preview}\n         ${msg}\n`);
      }
    }
  }

  console.log(`\n=== Ferdig: ${ok} OK, ${skipped} hoppet over ===\n`);

  // Verifiser at tabellene finnes
  console.log('Verifiserer tabeller…');
  const result = await pool.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE 'ai_metadata%'
    ORDER BY TABLE_NAME
  `);
  console.log('\nTabeller i databasen:');
  (result.recordset as { TABLE_NAME: string }[]).forEach(r => console.log('  ✓', r.TABLE_NAME));

  // Verifiser seed-data
  const views = await pool.request().query(`
    SELECT schema_name, view_name, visningsnavn, område
    FROM ai_metadata_views
    ORDER BY view_name
  `);
  console.log(`\nSeedede views (${views.recordset.length} stk):`);
  (views.recordset as Record<string, string>[]).forEach(r =>
    console.log(`  ✓ ${r['schema_name']}.${r['view_name']} — ${r['visningsnavn']} [${r['område']}]`),
  );

  // Verifiser regler for RUH
  const regler = await pool.request().query(`
    SELECT r.regel
    FROM ai_metadata_regler r
    JOIN ai_metadata_views v ON r.view_id = v.id
    WHERE v.view_name = 'vw_Fact_RUH'
  `);
  console.log(`\nRegler for vw_Fact_RUH (${regler.recordset.length} stk):`);
  (regler.recordset as { regel: string }[]).forEach(r => console.log(`  ✓ ${r.regel}`));

  await pool.close();
}

run().catch(err => {
  console.error('Fatal feil:', err);
  process.exit(1);
});
