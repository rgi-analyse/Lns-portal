import 'dotenv/config';
import * as sql from 'mssql';
import { prisma } from '../src/lib/prisma';

/**
 * Flytter ai_rapport_view_kobling-rader fra master til riktig tenant-DB.
 *
 * Bakgrunn: koblingene lå i master, men rapport_id er tenant-lokal. For hver
 * IKKE-LNS aktiv tenant flyttes de master-koblingene hvis rapport_id finnes i
 * tenantens egen Rapport-tabell (= tilhører den tenanten). LNS rører vi ikke
 * (lns-dwh == master, koblingene er allerede "på rett sted").
 *
 * FORUTSETNING: sql/014 må være kjørt mot tenant-DB-ene først (tabellen må finnes).
 *
 * Bruk:
 *   npx tsx scripts/migrerRapportViewKoblingerTilTenant.ts          # dry-run (viser plan)
 *   npx tsx scripts/migrerRapportViewKoblingerTilTenant.ts --apply  # utfør flytting
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

interface Kobling { rapport_id: string; view_id: string; prioritet: number; opprettet: Date }

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '=== APPLY-modus (utfører flytting) ===' : '=== DRY-RUN (ingen endringer) ===');

  const masterUrl = process.env.DATABASE_URL;
  if (!masterUrl) throw new Error('DATABASE_URL mangler.');

  const masterPool = await sql.connect(parsePrismaUrl(masterUrl));
  const masterKoblinger = (await masterPool.request().query(
    'SELECT rapport_id, view_id, prioritet, opprettet FROM ai_rapport_view_kobling',
  )).recordset as Kobling[];
  console.log(`Master har ${masterKoblinger.length} kobling(er) totalt.`);

  const tenants = await prisma.tenant.findMany({ where: { erAktiv: true } });
  const ikkeLns = tenants.filter((t) => t.slug !== 'lns');
  console.log(`Ikke-LNS aktive tenants: ${ikkeLns.map((t) => t.slug).join(', ') || '(ingen)'}`);

  for (const tenant of ikkeLns) {
    console.log(`\n--- Tenant: ${tenant.slug} (${tenant.navn}) ---`);
    const tenantPool = await new sql.ConnectionPool(parsePrismaUrl(tenant.databaseUrl)).connect();
    try {
      const rapportIds = new Set(
        ((await tenantPool.request().query('SELECT id FROM Rapport')).recordset as { id: string }[])
          .map((r) => r.id.toLowerCase()),
      );
      const tilFlytting = masterKoblinger.filter((k) => rapportIds.has(k.rapport_id.toLowerCase()));
      console.log(`  ${tilFlytting.length} kobling(er) tilhører ${tenant.slug}:`);
      for (const k of tilFlytting) console.log(`    rapport_id=${k.rapport_id} view_id=${k.view_id} prioritet=${k.prioritet}`);
      if (tilFlytting.length === 0) continue;

      if (!apply) { console.log('  (dry-run — hopper over insert/delete)'); continue; }

      for (const k of tilFlytting) {
        // Insert i tenant (idempotent), deretter slett fra master.
        await tenantPool.request()
          .input('rid', sql.NVarChar(200), k.rapport_id)
          .input('vid', sql.UniqueIdentifier, k.view_id)
          .input('pri', sql.Int, k.prioritet)
          .input('opp', sql.DateTime, k.opprettet)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM ai_rapport_view_kobling WHERE rapport_id = @rid AND view_id = @vid)
            INSERT INTO ai_rapport_view_kobling (rapport_id, view_id, prioritet, opprettet)
            VALUES (@rid, @vid, @pri, @opp)
          `);
        await masterPool.request()
          .input('rid', sql.NVarChar(200), k.rapport_id)
          .input('vid', sql.UniqueIdentifier, k.view_id)
          .query('DELETE FROM ai_rapport_view_kobling WHERE rapport_id = @rid AND view_id = @vid');
        console.log(`    ✓ flyttet rapport_id=${k.rapport_id} view_id=${k.view_id}`);
      }
    } finally {
      await tenantPool.close();
    }
  }

  await masterPool.close();
  await prisma.$disconnect();
  console.log('\nFerdig.');
}

main().catch((err) => { console.error('Fatal feil:', err); process.exit(1); });
