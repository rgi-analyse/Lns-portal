/**
 * Selv-test: fail-closed sensor-tilgang gjelder IDENTISK for begge datakilder
 * (kusto + azuresql), uten kilde-spesifikk bypass. Kjøres: `npm run check:sensor`
 * (exit ≠ 0 ved feil).
 *
 * Kjerne-invariant som låses her: harTilgangTilSensor(tilgang, sensorId) tar INGEN
 * dataKilde-parameter → det er strukturelt umulig å gi tilgang ulikt per kilde.
 * Ruten (sensor.ts) MÅ sjekke tilgang FØR den velger service (velgSensorKilde);
 * denne testen verifiserer primitivene ruten bygger på, i den rekkefølgen.
 */
import {
  hentSensorTilgang,
  harTilgangTilSensor,
  INGEN_SENSORTILGANG,
  type SensorTilgang,
} from '../services/sensorTilgang';
import { velgSensorKilde } from '../services/sensorKilder';
import { kustoSensorKilde } from '../services/kustoService';
import { azureSqlSensorKilde } from '../services/azureSqlSensorService';
import type { SensorKonfig } from '../services/sensorDataKilde';

let feil = 0;
function ok(cond: boolean, navn: string) {
  console.log(`${cond ? '  ✓' : '  ✗ FEIL:'} ${navn}`);
  if (!cond) feil++;
}
/** Assert at fn() KASTER (ugyldig/farlig konfig avvises av validerKonfig). */
function kaster(fn: () => void, navn: string) {
  let kastet = false;
  try { fn(); } catch { kastet = true; }
  ok(kastet, navn);
}
/** Assert at fn() IKKE kaster (gyldig konfig godtas). */
function godtar(fn: () => void, navn: string) {
  let kastet = false;
  try { fn(); } catch { kastet = true; }
  ok(!kastet, navn);
}

// Azure SQL-konfig med gyldige default-verdier; overstyres per case.
const azureKonfig = (over: Partial<SensorKonfig>): SensorKonfig => ({
  sensorId: '1', dataKilde: 'azuresql', kqlTabell: null, kqlVerdiFelt: null,
  azureSqlTabell: 'gold.Fact_Skaland_Avlesing_Sensorer',
  azureSqlIdKolonne: 'SensorNr', azureSqlVerdiKolonne: 'verdi', azureSqlTidKolonne: 'timestamp',
  ...over,
});
const kusto = (over: Partial<SensorKonfig>): SensorKonfig => ({
  sensorId: '1', dataKilde: 'kusto', kqlTabell: 'SensorData', kqlVerdiFelt: 'fill_grade',
  azureSqlTabell: null, azureSqlIdKolonne: null, azureSqlVerdiKolonne: null, azureSqlTidKolonne: null,
  ...over,
});

// Fake tenant-prisma: workspace.findMany returnerer sensor-allow-lista vi ber om.
const fakePrisma = (sensorIds: string[]): any => ({
  workspace: {
    findMany: async () => [{ sensorer: sensorIds.map((sensorId) => ({ sensorId })) }],
    findFirst: async () => null,
  },
});
const kastePrisma = (): any => ({
  workspace: { findMany: async () => { throw new Error('DB nede'); }, findFirst: async () => null },
});

// To sensorer med SAMME id-mekanikk, ulik datakilde — beviser at gaten ikke ser kilde.
const KUSTO = { id: 'sensor-kusto-1', dataKilde: 'kusto' };
const AZURE = { id: 'sensor-azuresql-1', dataKilde: 'azuresql' };

/** Speiler rutens rekkefølge: tilgang FØRST, deretter kilde-valg. */
function ruteGate(tilgang: SensorTilgang, sensor: { id: string; dataKilde: string }) {
  if (!harTilgangTilSensor(tilgang, sensor.id)) return { status: 403 as const };
  const kilde = velgSensorKilde(sensor.dataKilde);
  if (!kilde) return { status: 500 as const };
  return { status: 200 as const, kilde };
}

async function main() {
  console.log('\nsensor fail-closed selv-test\n');

  // ── velgSensorKilde: kjent → service, ukjent → null (fail-closed) ──
  console.log('Datakilde-registry:');
  ok(velgSensorKilde('kusto') === kustoSensorKilde, "velgSensorKilde('kusto') → kustoSensorKilde");
  ok(velgSensorKilde('azuresql') === azureSqlSensorKilde, "velgSensorKilde('azuresql') → azureSqlSensorKilde");
  ok(velgSensorKilde('ukjent') === null, "velgSensorKilde('ukjent') → null (fail-closed)");
  ok(velgSensorKilde('') === null, "velgSensorKilde('') → null (fail-closed)");

  // ── hentSensorTilgang: fail-closed-tilstander ──
  console.log('\nhentSensorTilgang (fail-closed):');
  const utenIdentitet = await hentSensorTilgang({ erAdminTilgang: false, tenantPrisma: fakePrisma([KUSTO.id]) });
  ok(utenIdentitet === INGEN_SENSORTILGANG, 'ingen entraObjectId/grupper → INGEN_SENSORTILGANG');

  const dbFeiler = await hentSensorTilgang({ erAdminTilgang: false, entraObjectId: 'u1', tenantPrisma: kastePrisma() });
  ok(dbFeiler === INGEN_SENSORTILGANG, 'DB kaster → INGEN_SENSORTILGANG (ikke allow-all)');

  const tomAllowList = await hentSensorTilgang({ erAdminTilgang: false, entraObjectId: 'u1', tenantPrisma: fakePrisma([]) });
  ok(tomAllowList === INGEN_SENSORTILGANG, 'tom allow-list → INGEN_SENSORTILGANG');

  // ── Kjerne: identisk gate for begge kilder ──
  console.log('\nIdentisk gate for begge datakilder:');

  // Nektet bruker (ingen tilgang) → 403 for BEGGE kilder, kilde velges aldri.
  ok(ruteGate(INGEN_SENSORTILGANG, KUSTO).status === 403, 'nektet bruker + kusto-sensor → 403');
  ok(ruteGate(INGEN_SENSORTILGANG, AZURE).status === 403, 'nektet bruker + azuresql-sensor → 403 (ingen bypass)');

  // Bruker med tilgang KUN til kusto-sensoren: azuresql-sensoren (annen id) nektes.
  // Beviser at gaten styres av Sensor.id, ikke av dataKilde — samme mekanikk.
  const kunKusto = await hentSensorTilgang({
    erAdminTilgang: false, entraObjectId: 'u1', tenantPrisma: fakePrisma([KUSTO.id]),
  });
  ok(ruteGate(kunKusto, KUSTO).status === 200, 'bruker m/tilgang til kusto-id → 200');
  ok(ruteGate(kunKusto, AZURE).status === 403, 'samme bruker, azuresql-id ikke i allow-list → 403');

  // Bruker med tilgang til azuresql-sensoren → 200 og RIKTIG service.
  const kunAzure = await hentSensorTilgang({
    erAdminTilgang: false, entraObjectId: 'u1', tenantPrisma: fakePrisma([AZURE.id]),
  });
  const azureRes = ruteGate(kunAzure, AZURE);
  ok(azureRes.status === 200 && azureRes.kilde === azureSqlSensorKilde, 'bruker m/tilgang til azuresql-id → 200 + azureSqlSensorKilde');

  // Admin → mode:'admin' gir tilgang til begge kilder (bevisst, kilde-agnostisk bypass).
  const admin = await hentSensorTilgang({ erAdminTilgang: true, tenantPrisma: fakePrisma([]) });
  ok(ruteGate(admin, KUSTO).status === 200 && ruteGate(admin, AZURE).status === 200,
    'admin → 200 for begge kilder (bypass er kilde-agnostisk)');

  // ── Identifier-validering / injeksjon (defense-in-depth, begge kilder) ──
  // validerKonfig er samme sti ruten bruker FØR interpolering. Ingen DB — ren validering.
  console.log('\nIdentifier-validering — FARLIGE inputs avvises (azuresql):');
  const v = (k: SensorKonfig) => () => azureSqlSensorKilde.validerKonfig(k);
  kaster(v(azureKonfig({ azureSqlTabell: 'gold.Fact; DROP TABLE x' })), 'tabell m/ «;» + mellomrom (stacked query) → avvist');
  kaster(v(azureKonfig({ azureSqlTabell: "gold.Fact'--" })),            'tabell m/ apostrof + kommentar → avvist');
  kaster(v(azureKonfig({ azureSqlTabell: 'gold..Fact' })),             'tabell m/ tom del (gold..Fact) → avvist');
  kaster(v(azureKonfig({ azureSqlTabell: 'a.b.c' })),                  'tabell m/ 3 deler (a.b.c) → avvist');
  kaster(v(azureKonfig({ azureSqlTabell: 'gold.[Fact]' })),           'tabell m/ bracket-injeksjon → avvist');
  kaster(v(azureKonfig({ azureSqlTabell: '../secret' })),             'tabell m/ path-traversal («../») → avvist');
  kaster(v(azureKonfig({ azureSqlTabell: 'a'.repeat(201) })),         'tabell > 200 tegn → avvist');
  kaster(v(azureKonfig({ azureSqlIdKolonne: 'Sensor Nr' })),          'kolonne m/ mellomrom → avvist');
  kaster(v(azureKonfig({ azureSqlVerdiKolonne: 'verdi;DROP' })),      'kolonne m/ «;» → avvist');
  kaster(v(azureKonfig({ azureSqlTidKolonne: 'ts.col' })),            'kolonne m/ punktum (kun tabell tillater «.») → avvist');
  kaster(v(azureKonfig({ azureSqlTidKolonne: '' })),                  'tom kolonne → avvist (presens)');
  kaster(v(azureKonfig({ azureSqlTabell: null })),                    'manglende tabell → avvist (presens)');

  console.log('\nIdentifier-validering — GYLDIGE inputs godtas (azuresql):');
  godtar(v(azureKonfig({})),                                          'gold.Fact_Skaland_Avlesing_Sensorer + SensorNr/verdi/timestamp → OK');
  godtar(v(azureKonfig({ azureSqlTabell: 'Fact_Skaland' })),          'tabell uten schema (1 del) → OK');
  godtar(v(azureKonfig({ azureSqlTabell: 'gold.Fact_2024', azureSqlVerdiKolonne: 'col_1' })), 'underscore + siffer → OK');
  // SQL-keyword som BART tabellnavn er en gyldig identifier; bracket-quoting ([DROP])
  // nøytraliserer nøkkelord-betydningen → godtas trygt (defense = quoting, ikke blokk-liste).
  godtar(v(azureKonfig({ azureSqlTabell: 'DROP', azureSqlVerdiKolonne: 'DELETE' })), 'keyword-navn (DROP/DELETE) → OK (nøytralisert av bracket-quoting)');

  console.log('\nIdentifier-validering — Kusto-kilden avviser tilsvarende:');
  kaster(() => kustoSensorKilde.validerKonfig(kusto({ kqlTabell: 'Tabell; drop' })), 'kqlTabell m/ «;» → avvist');
  kaster(() => kustoSensorKilde.validerKonfig(kusto({ kqlVerdiFelt: null })),        'manglende kqlVerdiFelt → avvist (presens)');
  godtar(() => kustoSensorKilde.validerKonfig(kusto({})),                            'gyldig kusto-konfig → OK');

  // MERK: datetime2/datetimeoffset-verifisering (verifiserTidskolonne) krever live
  // lns-dwh og dekkes av den manuelle provisjonerings-testen, ikke denne offline-testen.

  console.log(feil === 0 ? '\n✅ Selv-test bestått.\n' : `\n❌ Selv-test feilet: ${feil} assert(er).\n`);
  process.exit(feil === 0 ? 0 : 1);
}

main();
