import 'dotenv/config';
import * as sql from 'mssql';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/lib/prisma';

/**
 * Kjører en SQL-fil mot alle aktive tenants sine databaser.
 * Bruk:
 *   npx tsx scripts/runSqlPaaAlleTenants.ts sql/010_workspace_sortorder.sql
 */

function parsePrismaUrl(url: string): sql.config {
  const withoutProtocol = url.replace(/^sqlserver:\/\//, '');
  const parts = withoutProtocol.split(';');
  const [server, portStr] = parts[0].split(':');
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq !== -1) params[part.slice(0, eq).toLowerCase()] = part.slice(eq + 1);
  }
  return {
    server,
    port: portStr ? parseInt(portStr, 10) : 1433,
    database: params['database'],
    user: params['user'],
    password: params['password'],
    options: {
      encrypt: params['encrypt'] !== 'false',
      trustServerCertificate: params['trustservercertificate'] === 'true',
    },
  };
}

async function kjørMotDatabase(label: string, databaseUrl: string, batches: string[]) {
  console.log(`\n=== ${label} ===`);
  const pool = await sql.connect(parsePrismaUrl(databaseUrl));
  try {
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const preview = batch.substring(0, 80).replace(/\s+/g, ' ');
      try {
        await pool.request().query(batch);
        console.log(`  [OK ${i + 1}] ${preview}…`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists') || msg.includes('There is already')) {
          console.log(`  [SKIP ${i + 1}] Eksisterer allerede`);
        } else {
          console.error(`  [FEIL ${i + 1}] ${msg}`);
          throw err;
        }
      }
    }
  } finally {
    await pool.close();
  }
}

async function main() {
  const sqlPath = process.argv[2];
  if (!sqlPath) {
    console.error('Bruk: npx tsx scripts/runSqlPaaAlleTenants.ts <sti-til-sql-fil>');
    process.exit(1);
  }

  const fullPath = path.isAbsolute(sqlPath) ? sqlPath : path.join(__dirname, '..', sqlPath);
  const content = fs.readFileSync(fullPath, 'utf8');

  const batches = content
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter((b) => b.replace(/--[^\n]*/g, '').trim().length > 0);

  console.log(`SQL-fil: ${fullPath}`);
  console.log(`${batches.length} batch(er)`);

  const tenants = await prisma.tenant.findMany({ where: { erAktiv: true } });
  console.log(`\nFant ${tenants.length} aktive tenant(s): ${tenants.map((t) => t.slug).join(', ')}`);

  for (const tenant of tenants) {
    await kjørMotDatabase(`Tenant: ${tenant.slug} (${tenant.navn})`, tenant.databaseUrl, batches);
  }

  console.log('\nFerdig.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal feil:', err);
  process.exit(1);
});
