/**
 * Kjørbar test for validerSqlMotTilgang (ren funksjon, ingen DB).
 * Kjør: tsx apps/api/src/scripts/testDatatilgang.ts
 *
 * Dekker testkravene fra sikkerhetsscenariet: robust view-uttrekk
 * (schema-qualified, CTE, ikke-vw_), SELECT-only, fail-closed.
 */
import { validerSqlMotTilgang, hentDatatilgang, type Datatilgang } from '../services/datatilgang';

const begrenset: Datatilgang = {
  mode: 'begrenset',
  tillatteViewIds: ['1', '2'],
  tillatteViewNavn: new Set(['vw_fact_bolting', 'dim_prosjekt']), // merk: dim_ uten vw_-prefiks
};
const admin: Datatilgang = { mode: 'admin' };

let feil = 0;
function sjekk(navn: string, faktisk: boolean, forventet: boolean): void {
  const ok = faktisk === forventet;
  if (!ok) feil++;
  console.log(`${ok ? 'OK  ' : 'FEIL'}  ${navn} (forventet ok=${forventet}, fikk ok=${faktisk})`);
}

// 1. Tillatt view → ok
sjekk('tillatt ai_gold-view',
  validerSqlMotTilgang('SELECT * FROM ai_gold.vw_Fact_Bolting', begrenset).ok, true);

// 2. Ikke-tillatt view (scenariet: mobiltransaksjoner) → nekt
sjekk('ikke-tillatt view (mobiltransaksjoner)',
  validerSqlMotTilgang('SELECT * FROM ai_gold.vw_Fact_mobiltransaksjoner', begrenset).ok, false);

// 3. View uten vw_-prefiks, men tillatt → ok (uttrekk på navn, ikke prefiks)
sjekk('tillatt view uten vw_-prefiks',
  validerSqlMotTilgang('SELECT * FROM ai_gold.dim_Prosjekt', begrenset).ok, true);

// 4. View uten vw_-prefiks, ikke tillatt → nekt
sjekk('ikke-tillatt view uten vw_-prefiks',
  validerSqlMotTilgang('SELECT * FROM ai_gold.dim_Hemmelig', begrenset).ok, false);

// 5. CTE som maskerer ikke-tillatt view → nekt (kroppen navngir ai_gold.<ikke-tillatt>)
sjekk('CTE maskerer ikke-tillatt view',
  validerSqlMotTilgang(
    'WITH x AS (SELECT * FROM ai_gold.vw_Fact_mobiltransaksjoner) SELECT * FROM x', begrenset).ok, false);

// 6. CTE over tillatt view → ok
sjekk('CTE over tillatt view',
  validerSqlMotTilgang(
    'WITH x AS (SELECT * FROM ai_gold.vw_Fact_Bolting) SELECT * FROM x', begrenset).ok, true);

// 7. JOIN der ett view ikke er tillatt → nekt
sjekk('JOIN med ett ikke-tillatt view',
  validerSqlMotTilgang(
    'SELECT * FROM ai_gold.vw_Fact_Bolting b JOIN ai_gold.vw_Fact_mobiltransaksjoner m ON b.id=m.id',
    begrenset).ok, false);

// 8. Annet schema (ikke ai_gold) → nekt
sjekk('annet schema blokkeres',
  validerSqlMotTilgang('SELECT * FROM dbo.Hemmelig', begrenset).ok, false);

// 9. Ukvalifisert tabell (ingen schema, ikke CTE) → nekt
sjekk('ukvalifisert tabell blokkeres',
  validerSqlMotTilgang('SELECT * FROM vw_Fact_Bolting', begrenset).ok, false);

// 10. Kommentar-skjult ikke-tillatt view → nekt (kommentar strippes, men FROM gjelder)
sjekk('kommentar endrer ikke vurdering',
  validerSqlMotTilgang(
    'SELECT * /* kommentar */ FROM ai_gold.vw_Fact_mobiltransaksjoner -- skjult', begrenset).ok, false);

// 11. INSERT/UPDATE/DELETE → nekt (også implisitt)
for (const farlig of [
  'INSERT INTO ai_gold.vw_Fact_Bolting VALUES (1)',
  'UPDATE ai_gold.vw_Fact_Bolting SET x=1',
  'DELETE FROM ai_gold.vw_Fact_Bolting',
  'DROP TABLE ai_gold.vw_Fact_Bolting',
  'SELECT * INTO ny FROM ai_gold.vw_Fact_Bolting',
  'EXEC sp_who',
]) {
  sjekk(`farlig SQL blokkeres: ${farlig.slice(0, 28)}…`,
    validerSqlMotTilgang(farlig, begrenset).ok, false);
}

// 12. Stacked queries → nekt
sjekk('stacked query blokkeres',
  validerSqlMotTilgang('SELECT 1; DROP TABLE x', begrenset).ok, false);

// 13. Tom allow-list → alt nektes
sjekk('tom allow-list nekter tillatt-lignende',
  validerSqlMotTilgang('SELECT * FROM ai_gold.vw_Fact_Bolting',
    { mode: 'begrenset', tillatteViewIds: [], tillatteViewNavn: new Set() }).ok, false);

// 14. Admin → SELECT mot hva som helst ok, men skriv fortsatt blokkert
sjekk('admin SELECT hvilket som helst view',
  validerSqlMotTilgang('SELECT * FROM ai_gold.vw_Fact_mobiltransaksjoner', admin).ok, true);
sjekk('admin DELETE fortsatt blokkert',
  validerSqlMotTilgang('DELETE FROM ai_gold.vw_Fact_Bolting', admin).ok, false);

// ── hentDatatilgang (mocket Prisma) ─────────────────────────────────────────
async function kjørHentDatatilgangTester(): Promise<void> {
  // A. opprettetAv gir IKKE tilgang: bruker uten Tilgang-rad → tom allow-list,
  //    og spørringen skal bruke Tilgang-relasjonen (ikke opprettetAv/OR).
  let captured: any = null;
  const prismaUtenTilgang = {
    workspace: { findMany: async (args: any) => { captured = args; return []; } },
  };
  const rA = await hentDatatilgang({
    erAdminTilgang: false, entraObjectId: 'u-creator', tenantPrisma: prismaUtenTilgang, dbUrl: 'dummy',
  });
  sjekk('opprettetAv gir IKKE tilgang (tom allow-list)',
    rA.mode === 'begrenset' && rA.tillatteViewIds.length === 0, true);
  const w = captured?.where ?? {};
  sjekk('spørring bruker kun Tilgang (ingen opprettetAv/OR)',
    !!w.tilgang && w.OR === undefined && w.opprettetAv === undefined, true);

  // B. Spoofet/ukjent rapportId → tom (verifiseres mot tilgjengelige rapporter).
  const prismaMedRapport = {
    workspace: { findMany: async () => [{ rapporter: [{ rapportId: 'rapp-A' }] }] },
  };
  const rB = await hentDatatilgang(
    { erAdminTilgang: false, entraObjectId: 'u1', tenantPrisma: prismaMedRapport, dbUrl: 'dummy' },
    { rapportId: 'rapp-SPOOF' });
  sjekk('spoofet rapportId → tom allow-list',
    rB.mode === 'begrenset' && rB.tillatteViewIds.length === 0, true);

  // C. Admin → mode:'admin' (ingen DB-oppslag).
  const rC = await hentDatatilgang({
    erAdminTilgang: true, entraObjectId: 'u1',
    tenantPrisma: { workspace: { findMany: async () => [] } }, dbUrl: 'dummy',
  });
  sjekk('admin → mode:admin', rC.mode === 'admin', true);

  // D. Ingen identitet → tom (fail-closed).
  const rD = await hentDatatilgang({
    erAdminTilgang: false,
    tenantPrisma: { workspace: { findMany: async () => [] } }, dbUrl: 'dummy',
  });
  sjekk('ingen identitet → tom', rD.mode === 'begrenset' && rD.tillatteViewIds.length === 0, true);

  // E. Tom dbUrl → tom (fail-closed).
  const rE = await hentDatatilgang({
    erAdminTilgang: false, entraObjectId: 'u1',
    tenantPrisma: { workspace: { findMany: async () => [{ rapporter: [{ rapportId: 'x' }] }] } }, dbUrl: '',
  });
  sjekk('tom dbUrl → tom', rE.mode === 'begrenset' && rE.tillatteViewIds.length === 0, true);
}

kjørHentDatatilgangTester().then(() => {
  console.log(feil === 0 ? '\nALLE TESTER OK' : `\n${feil} TEST(ER) FEILET`);
  process.exit(feil === 0 ? 0 : 1);
});
