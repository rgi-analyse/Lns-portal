/**
 * Manuell trigger av samme jobb som scheduler kjører kl 06:00.
 *
 * Brukes til:
 *   - Verifisering at scheduler-jobben fungerer (uten å vente til neste 06:00)
 *   - Re-indeksering på ad-hoc-basis (f.eks. etter datasett-endring)
 *   - Test av fail-soft-flyt (f.eks. deaktiver et datasett midlertidig
 *     for å se at de andre konfig-ene fortsatt går gjennom)
 *
 * Kjøres: npx tsx scripts/kjorIndekseringNa.ts
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { kjorAlleAktive } from '../src/services/slicerIndekseringScheduler';

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('MANUELL TRIGGER — kjorAlleAktive');
  console.log('═══════════════════════════════════════════════════\n');

  const t0 = Date.now();
  const r = await kjorAlleAktive();
  const total = Date.now() - t0;

  console.log('\n───────────────────────────────────────────────────');
  console.log('Sammendrag:');
  console.log(`  Totalt:          ${r.total} konfigurasjoner`);
  console.log(`  Suksess:         ${r.suksess}`);
  console.log(`  Feilet:          ${r.feilet}`);
  console.log(`  Total tid:       ${total}ms (${(total / 1000).toFixed(1)}s)`);
  console.log('───────────────────────────────────────────────────\n');

  if (r.feilet > 0) {
    console.log('Feilete konfig-er:');
    for (const res of r.resultater) {
      if (res.feil) {
        console.log(`  ✗ ${res.slicer_tittel}: ${res.feil}`);
      }
    }
    console.log();
  }

  if (r.suksess > 0) {
    console.log('Vellykkede konfig-er:');
    for (const res of r.resultater) {
      if (!res.feil) {
        console.log(`  ✓ ${res.slicer_tittel}: ${res.antall_rader} rader (DAX ${res.spørrings_ms}ms + indeks ${res.indekserings_ms}ms)`);
      }
    }
    console.log();
  }

  // Exit-kode = antall feilet (0 hvis alt OK)
  process.exit(r.feilet);
}

main()
  .catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
