/**
 * CLI: re-indekser én slicer ut fra konfig-id.
 *
 * Usage:  npx tsx scripts/reIndekserSlicer.ts <konfig-id>
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { indekserSlicer } from '../src/services/slicerIndekseringService';

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id) {
    console.error('Mangler konfig-id som argument.\nUsage: npx tsx scripts/reIndekserSlicer.ts <konfig-id>');
    process.exit(1);
  }

  const konfig = await prisma.slicerIndeksering.findUnique({ where: { id } });
  if (!konfig) {
    console.error(`Konfig "${id}" ikke funnet.`);
    process.exit(1);
  }
  if (!konfig.er_aktiv) {
    console.error(`Konfig "${konfig.slicer_tittel}" (${id}) er inaktiv. Aktiver den først.`);
    process.exit(1);
  }

  console.log(`Re-indekserer "${konfig.slicer_tittel}" (${konfig.slicer_type}) for rapport ${konfig.rapport_id}...`);
  const t0 = Date.now();
  const r  = await indekserSlicer(id);
  const total = Date.now() - t0;

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`✓ Indeksering ferdig på ${total}ms`);
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Slicer:           ${r.slicer_tittel}`);
  console.log(`  Antall rader:     ${r.antall_rader}`);
  console.log(`  DAX-spørring:     ${r.spørrings_ms}ms`);
  console.log(`  Indekserings-tid: ${r.indekserings_ms}ms`);
  if (r.feil) {
    console.log(`  Feil:             ${r.feil}`);
  }
}

main()
  .catch((err) => {
    console.error('\nFEIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
