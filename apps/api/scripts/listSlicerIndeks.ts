/**
 * CLI: list alle slicer-indekserings-konfigurasjoner.
 *
 * Viser ID, rapport-navn, slicer, type, sist indeksert, antall rader, status.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

function farge(streng: string, farge: 'gul' | 'grønn' | 'rød' | 'grå'): string {
  if (!process.stdout.isTTY) return streng;
  const koder = { gul: '33', grønn: '32', rød: '31', grå: '90' };
  return `\x1b[${koder[farge]}m${streng}\x1b[0m`;
}

function trunker(s: string, lengde: number): string {
  return s.length > lengde ? s.slice(0, lengde - 1) + '…' : s.padEnd(lengde);
}

function alderSiden(dato: Date | null): string {
  if (!dato) return 'aldri';
  const ms = Date.now() - dato.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1)        return 'nå nettopp';
  if (min < 60)       return `${min}m siden`;
  const t = Math.floor(min / 60);
  if (t < 48)         return `${t}t siden`;
  const d = Math.floor(t / 24);
  return `${d}d siden`;
}

async function main(): Promise<void> {
  const konfiger = await prisma.slicerIndeksering.findMany({
    orderBy: [{ tenant: 'asc' }, { slicer_tittel: 'asc' }],
  });

  const rapportNavn = new Map<string, string>();
  const rapportIds  = [...new Set(konfiger.map((k) => k.rapport_id))];
  if (rapportIds.length > 0) {
    const rapporter = await prisma.rapport.findMany({
      where:  { id: { in: rapportIds } },
      select: { id: true, navn: true },
    });
    rapporter.forEach((r) => rapportNavn.set(r.id, r.navn));
  }

  if (konfiger.length === 0) {
    console.log('Ingen slicer-indekserings-konfigurasjoner.');
    return;
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(
    farge('ID                                  ', 'grå') +
    'Rapport                       Slicer            Type        Sist          Rader  Status',
  );
  console.log('───────────────────────────────────────────────────────────────────────────────────────────────────────');

  for (const k of konfiger) {
    const navn   = rapportNavn.get(k.rapport_id) ?? '(ukjent)';
    const status = k.er_aktiv
      ? (k.sist_indeksert ? farge('ok', 'grønn') : farge('aldri kjørt', 'gul'))
      : farge('inaktiv', 'rød');
    const alder  = alderSiden(k.sist_indeksert);
    const rader  = k.sist_antall_rader != null ? String(k.sist_antall_rader) : '-';

    console.log(
      farge(k.id, 'grå') + '  ' +
      trunker(navn, 28)  + '  ' +
      trunker(k.slicer_tittel, 16) + '  ' +
      trunker(k.slicer_type, 10)   + '  ' +
      trunker(alder, 12)           + '  ' +
      rader.padStart(5)            + '  ' +
      status,
    );
  }
  console.log('───────────────────────────────────────────────────────────────────────────────────────────────────────');
  console.log(`${konfiger.length} konfig(er) totalt.`);
}

main()
  .catch((err) => {
    console.error('FEIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
