import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { queryAzureSQLForTenant } from '../services/azureSqlService';

async function main() {
  // Hent lns-tenant
  const tenant = await prisma.tenant.findFirst({
    where: { slug: 'lns' },
  });
  if (!tenant) {
    console.error('Fant ikke lns-tenant');
    process.exit(1);
  }
  console.log('[Test] Tenant funnet:', tenant.slug, 'DB-URL satt:', !!tenant.databaseUrl);

  // Test 1: Enkel query uten parametre
  console.log('\n[Test 1] SELECT TOP 1 fra ai_gold.vw_Fact_Regnskapstransksjoner');
  const test1 = await queryAzureSQLForTenant(
    tenant.databaseUrl,
    'SELECT TOP 1 * FROM ai_gold.vw_Fact_Regnskapstransksjoner',
  );
  console.log('  Resultat:', test1.length, 'rader');
  if (test1[0]) console.log('  Kolonner:', Object.keys(test1[0]).join(', '));

  // Test 2: Query med parametre (en av varekostnad-queriene)
  console.log('\n[Test 2] Varekostnad totalt_per_maaned med parametre');
  const test2 = await queryAzureSQLForTenant(
    tenant.databaseUrl,
    `SELECT årmåned AS maaned, SUM(Beløp) AS belop
     FROM ai_gold.vw_Fact_Regnskapstransksjoner
     WHERE Kontonr BETWEEN 4000 AND 4999
       AND dato BETWEEN @fraDato AND @tilDato
       AND (@prosjekt IS NULL OR Prosjekt = @prosjekt)
     GROUP BY årmåned
     ORDER BY årmåned`,
    {
      fraDato: '2026-01-01',
      tilDato: '2026-03-31',
      prosjekt: '4200',
    },
  );
  console.log('  Resultat:', test2.length, 'rader');
  test2.forEach(r => console.log('   ', r));

  // Test 3: Verifiser pool-cache (kjør samme query igjen, skal ikke logge "Ny tenant-pool")
  console.log('\n[Test 3] Kjør Test 1 igjen for å bekrefte pool-cache');
  await queryAzureSQLForTenant(
    tenant.databaseUrl,
    'SELECT TOP 1 * FROM ai_gold.vw_Fact_Regnskapstransksjoner',
  );
  console.log('  (Skal IKKE ha logget "Ny tenant-pool opprettet" igjen)');

  process.exit(0);
}

main().catch(err => {
  console.error('[Test] Feil:', err);
  process.exit(1);
});
