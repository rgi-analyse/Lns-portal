import 'dotenv/config';
import { queryAzureSQL } from '../src/services/azureSqlService';

// Finn en admin-bruker for testing
async function main() {
  // Hent admin-bruker fra Prisma-databasen (egen DB)
  const { PrismaClient } = await import('@synapse/db');
  const prisma = new PrismaClient();

  const admin = await prisma.bruker.findFirst({
    where: { rolle: 'admin', erAktiv: true },
    select: { entraObjectId: true, displayName: true },
  });

  if (!admin) {
    console.log('Ingen admin-bruker funnet.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Admin-bruker: ${admin.displayName} (${admin.entraObjectId})`);

  // Test metadata-endepunkt
  const https = await import('https');
  const options = {
    hostname: '10.0.1.132',
    port: 3001,
    path: '/api/admin/metadata/views',
    method: 'GET',
    rejectUnauthorized: false,
    headers: { 'X-Entra-Object-Id': admin.entraObjectId },
  };

  const data = await new Promise<string>((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });

  const views = JSON.parse(data);
  console.log(`\n=== GET /api/admin/metadata/views ===`);
  console.log(`Antall views: ${views.length}`);
  views.forEach((v: Record<string, unknown>) => {
    const kol = (v['kolonner'] as unknown[]).length;
    const reg = (v['regler'] as unknown[]).length;
    console.log(`  ${v['schema_name']}.${v['view_name']}: ${kol} kolonner, ${reg} regler`);
  });

  // Test discover
  const discRes = await new Promise<string>((resolve, reject) => {
    const req = https.request({ ...options, path: '/api/admin/metadata/discover' }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });

  const disc = JSON.parse(discRes);
  console.log(`\n=== GET /api/admin/metadata/discover ===`);
  console.log(`Nye views i ai_gold: ${disc.antall}`);
  if (disc.views?.length) disc.views.forEach((v: Record<string, string>) => console.log(`  ${v['schema_name']}.${v['view_name']}`));

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
