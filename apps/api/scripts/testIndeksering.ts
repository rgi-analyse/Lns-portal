/**
 * End-to-end-test for slicerIndekseringService.
 *
 * Trinn:
 *   1. Slett gammelt test-data fra synapse-slicer-katalog (5 dokumenter fra Fase 2B)
 *   2. Kjør Prisma-migrasjon for ai_slicer_indeksering
 *   3. Kjør seed-SQL (idempotent MERGE)
 *   4. Indekser begge konfigurasjoner via slicerIndekseringService
 *   5. Verifiser ved å søke i indeksen
 *   6. Vis ai_slicer_indeksering-status etter kjøring
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { queryAzureSQL, executeAzureSQL } from '../src/services/azureSqlService';
import { prisma } from '../src/lib/prisma';
import { getSearchService } from '../src/services/searchService';
import { SLICER_INDEKS_NAVN, søk } from '../src/services/slicerKatalogService';
import { indekserSlicer } from '../src/services/slicerIndekseringService';

const FASE2B_DOC_IDS = [
  'lns_6c758833-1f94-497f-b89a-2e89b4db2af7_Hovedprosjekt_T_LeRsM',  // 4200 - Nussir
  'lns_6c758833-1f94-497f-b89a-2e89b4db2af7_Hovedprosjekt_KSCRzpQ7', // 4600 - Snøhvit Future Project
  'lns_6c758833-1f94-497f-b89a-2e89b4db2af7_Hovedprosjekt_v3aVmDxN', // 5400 - Rana Gruber
  'lns_8a686e18-aaaa-bbbb-cccc-ddddeeeeffff_LevNavn_dlD6vzZG',       // BDO AS
  'lns_8a686e18-aaaa-bbbb-cccc-ddddeeeeffff_LevNavn_HpUf08yb',       // Vianor AS
];

async function ryddOppFase2BTestData(): Promise<void> {
  console.log('\n1) Rydder bort Fase 2B test-data fra synapse-slicer-katalog');
  const service = getSearchService();
  const finnes  = await service.finnesIndeks(SLICER_INDEKS_NAVN);
  if (!finnes) {
    console.log('   indeks finnes ikke ennå — hopper over opprydning');
    return;
  }
  // Rydd bredt: slett alle dokumenter med tenant=lns og rapport_id matching de to test-rapportene.
  // Bruk søk + slett siden vi ikke har eksakte ID-er garantert.
  await service.slettDokumenter(SLICER_INDEKS_NAVN, 'id', FASE2B_DOC_IDS);
  console.log(`   forsøkte å slette ${FASE2B_DOC_IDS.length} kjente Fase 2B-ID-er`);
}

async function kjørMigrasjon(): Promise<void> {
  console.log('\n2) Kjører Prisma-migrasjon for ai_slicer_indeksering');
  const migrasjonPath = path.join(
    __dirname, '..', 'prisma', 'migrations',
    '20260507120000_add_ai_slicer_indeksering', 'migration.sql',
  );
  const sql = fs.readFileSync(migrasjonPath, 'utf8');
  await executeAzureSQL(sql);
  console.log('   migrasjon kjørt');
}

async function kjørSeed(): Promise<void> {
  console.log('\n3) Kjører seed-SQL');
  const seedPath = path.join(__dirname, 'seedSlicerIndeksering.sql');
  const sql = fs.readFileSync(seedPath, 'utf8');
  await executeAzureSQL(sql);

  const rader = await queryAzureSQL(`SELECT slicer_tittel, slicer_type FROM ai_slicer_indeksering`);
  console.log(`   ${rader.length} konfig(er) i tabellen:`);
  for (const r of rader) console.log(`     - ${(r as { slicer_tittel: string }).slicer_tittel} (${(r as { slicer_type: string }).slicer_type})`);
}

async function indekserBegge(): Promise<void> {
  console.log('\n4) Indekserer begge konfigurasjoner');
  const konfiger = await prisma.slicerIndeksering.findMany({
    where: { tenant: 'lns', er_aktiv: true },
    orderBy: { slicer_tittel: 'asc' },
  });

  for (const k of konfiger) {
    console.log(`\n   → "${k.slicer_tittel}"`);
    const r = await indekserSlicer(k.id);
    console.log(`     ✓ ${r.antall_rader} rader | DAX ${r.spørrings_ms}ms | indeks ${r.indekserings_ms}ms`);
  }
}

interface SøkScenario {
  navn:           string;
  rapport_id:     string;
  slicer_tittel:  string;
  søketerm:       string;
  forventet:      string;
}

const RAPPORT_RESULTAT = '6c758833-1f94-497f-b89a-2e89b4db2af7';
const RAPPORT_LEV      = '8a686e18-5ed2-449c-a010-7cc6a6cd25d7';

async function verifiserMedSøk(): Promise<boolean> {
  console.log('\n5) Verifiserer via søk');

  // Vent på indeksering — Azure Search er eventually consistent.
  console.log('   venter 4 sek på at dokumentene blir søkbare...');
  await new Promise((res) => setTimeout(res, 4000));

  const scenarioer: SøkScenario[] = [
    { navn: 'Hovedprosjekt + "Nussir"',  rapport_id: RAPPORT_RESULTAT, slicer_tittel: 'Hovedprosjekt', søketerm: 'Nussir',  forventet: 'Nussir' },
    { navn: 'Hovedprosjekt + "Snøhvit"', rapport_id: RAPPORT_RESULTAT, slicer_tittel: 'Hovedprosjekt', søketerm: 'Snøhvit', forventet: 'Snøhvit' },
    { navn: 'LevNavn + "BDO"',           rapport_id: RAPPORT_LEV,      slicer_tittel: 'LevNavn',       søketerm: 'BDO',     forventet: 'BDO' },
    { navn: 'LevNavn + "Vianor"',        rapport_id: RAPPORT_LEV,      slicer_tittel: 'LevNavn',       søketerm: 'Vianor',  forventet: 'Vianor' },
  ];

  let alleOk = true;
  for (const s of scenarioer) {
    const respons = await søk({
      tenant:        'lns',
      rapport_id:    s.rapport_id,
      slicer_tittel: s.slicer_tittel,
      søketerm:      s.søketerm,
      top:           5,
    });
    const førsteTreffOk = respons.treff[0]?.verdi.includes(s.forventet) ?? false;
    if (!førsteTreffOk) alleOk = false;

    console.log(`\n   [${førsteTreffOk ? '✓' : '✗'}] ${s.navn}`);
    if (respons.treff.length === 0) {
      console.log('       Ingen treff');
      continue;
    }
    respons.treff.forEach((t, i) => {
      const merket = t.verdi.includes(s.forventet) ? '←' : ' ';
      console.log(`       ${i + 1}. score=${t.score.toFixed(3)} "${t.verdi}"${t.forelder_verdi ? ` (under ${t.forelder_verdi})` : ''} ${merket}`);
    });
  }

  return alleOk;
}

async function visStatus(): Promise<void> {
  console.log('\n6) Status fra ai_slicer_indeksering');
  const rader = await queryAzureSQL(`
    SELECT slicer_tittel, slicer_type, sist_indeksert, sist_antall_rader
    FROM ai_slicer_indeksering
    WHERE er_aktiv = 1
    ORDER BY slicer_tittel
  `);
  for (const r of rader) {
    const x = r as { slicer_tittel: string; slicer_type: string; sist_indeksert: Date | null; sist_antall_rader: number | null };
    const tid = x.sist_indeksert ? x.sist_indeksert.toISOString() : '(aldri)';
    console.log(`   - ${x.slicer_tittel} (${x.slicer_type}): ${x.sist_antall_rader ?? '-'} rader, sist ${tid}`);
  }
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('TEST — slicer-indeksering end-to-end');
  console.log('═══════════════════════════════════════════════════');

  try {
    await ryddOppFase2BTestData();
    await kjørMigrasjon();
    await kjørSeed();
    await indekserBegge();
    const ok = await verifiserMedSøk();
    await visStatus();

    console.log('\n───────────────────────────────────────────────────');
    console.log(ok
      ? '✓ Alle scenarioer grønne — indekserings-tjenesten fungerer'
      : '✗ Minst ett søk feilet — sjekk scores over');
    console.log('───────────────────────────────────────────────────\n');

    if (!ok) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
