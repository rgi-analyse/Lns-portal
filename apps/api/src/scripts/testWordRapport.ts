import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../lib/prisma';
import { lastNedBlob } from '../services/blobService';
import { byggWordRapport, type WordSeksjon } from '../services/wordService';

/**
 * Genererer .docx lokalt fra en ekte, fullført test-bestilling.
 * Bruk:
 *   npx tsx src/scripts/testWordRapport.ts [bestillingId]
 * Default-id er varekostnad-test-bestillingen.
 */
async function main() {
  const bestillingId = process.argv[2] ?? '85e05acf-ee05-4e29-ad55-26b3359a870c';
  console.log('[Test] Bestilling:', bestillingId);

  const bestilling = await prisma.analyseBestilling.findUnique({
    where: { id: bestillingId },
    include: { analyseType: { select: { id: true, navn: true, rapportStruktur: true } } },
  });
  if (!bestilling) {
    console.error('[Test] Fant ikke bestilling:', bestillingId);
    process.exit(1);
  }
  if (!bestilling.sammendrag) {
    console.error('[Test] Bestilling har ingen sammendrag (ikke FERDIG?). Status:', bestilling.status);
    process.exit(1);
  }

  const sammendrag = JSON.parse(bestilling.sammendrag) as {
    seksjoner: Record<string, string>;
    grafer?: Record<string, string>;
  };
  const parametre = JSON.parse(bestilling.parametre || '{}');

  // id → tittel fra rapportStruktur (samme kilde som orchestrator bruker)
  const struktur = bestilling.analyseType.rapportStruktur
    ? JSON.parse(bestilling.analyseType.rapportStruktur)
    : { seksjoner: [] };
  const tittelFor = new Map<string, string>();
  for (const s of (struktur.seksjoner ?? [])) {
    tittelFor.set(s.id, s.tittel ?? s.id);
  }

  const tema = await prisma.organisasjonTema.findFirst({ orderBy: { opprettet: 'asc' } });

  const datoRange = (fra?: string, til?: string): string => {
    const f = fra ? new Date(fra) : null;
    const t = til ? new Date(til) : null;
    const dm  = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' });
    const dmy = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
    if (f && t) return `${dm.format(f)} – ${dmy.format(t)}`;
    if (f) return dmy.format(f);
    if (t) return dmy.format(t);
    return '';
  };
  const prosjektDel = parametre.prosjekt ? `Prosjekt ${parametre.prosjekt}` : '';
  const rangeDel = datoRange(parametre.fraDato, parametre.tilDato);
  const undertittel = [prosjektDel, rangeDel].filter(Boolean).join(' · ') || undefined;

  const seksjoner: WordSeksjon[] = [];
  for (const [id, tekst] of Object.entries(sammendrag.seksjoner)) {
    const grafSti = sammendrag.grafer?.[id];
    let grafPng: Buffer | undefined;
    if (grafSti) {
      console.log('[Test] Laster ned graf:', grafSti);
      grafPng = await lastNedBlob(grafSti);
    }
    seksjoner.push({
      tittel: tittelFor.get(id) ?? (id.charAt(0).toUpperCase() + id.slice(1)),
      markdownTekst: tekst,
      grafPng,
    });
  }

  console.log(`[Test] Bygger Word: ${seksjoner.length} seksjoner, undertittel="${undertittel ?? ''}"`);
  const buffer = await byggWordRapport({
    tittel:       bestilling.analyseType.navn,
    undertittel,
    tenantNavn:   tema?.organisasjonNavn ?? 'LNS',
    generertDato: new Date(),
    seksjoner,
    temaPrimaer:  tema?.primaryColor ?? '#F5A623',
    temaNavy:     tema?.navyColor    ?? '#1B2A4A',
  });

  const utSti = join(process.cwd(), 'rapport.docx');
  writeFileSync(utSti, buffer);
  console.log(`\n[Test] Lagret ${utSti} (${Math.round(buffer.length / 1024)} KB)`);
  console.log('[Test] Åpne i Word for visuell vurdering. ✓');
  process.exit(0);
}

main().catch(err => {
  console.error('[Test] Feil:', err);
  if (err.statusCode) {
    console.error('  Status:', err.statusCode, 'Code:', err.code);
  }
  process.exit(1);
});
