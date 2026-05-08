/**
 * Smoketest for admin-slicer-indeks-endepunktene.
 *
 * Forventer at API-serveren kjører lokalt (npm run dev). Hits endepunktene
 * med ulike auth-headere og verifiserer status + grunn-shape.
 *
 * Forutsetning:
 *   - PORT (default 3001)
 *   - X-Tenant-Id-header settes manuelt av oss (skip subdomain-lookup)
 *   - Admin-user-id leses fra Prisma (første rolle=admin/tenantadmin)
 *
 * Kjøres: npx tsx scripts/testAdminEndepunkter.ts
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

const BASE   = `http://localhost:${process.env.PORT ?? 3001}`;
const TENANT = 'lns';

interface SjekkResultat {
  navn:           string;
  forventet:      string;
  faktisk:        string;
  ok:             boolean;
  detalj?:        string;
}

async function hent(url: string, opts: { entraId?: string; method?: string; body?: unknown } = {}): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'X-Tenant-Id': TENANT };
  if (opts.entraId) headers['X-Entra-Object-Id'] = opts.entraId;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const respons = await fetch(`${BASE}${url}`, {
    method:  opts.method ?? 'GET',
    headers,
    body:    opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body: unknown = null;
  try { body = await respons.json(); }
  catch { /* ignorer */ }
  return { status: respons.status, body };
}

function verifiserStatus(navn: string, faktisk: number, forventet: number, body?: unknown): SjekkResultat {
  return {
    navn,
    forventet: `HTTP ${forventet}`,
    faktisk:   `HTTP ${faktisk}`,
    ok:        faktisk === forventet,
    detalj:    body && typeof body === 'object' ? JSON.stringify(body).slice(0, 200) : undefined,
  };
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('SMOKETEST — admin-slicer-indeks-endepunkter');
  console.log(`Server: ${BASE}`);
  console.log('═══════════════════════════════════════════════════\n');

  // Hent admin-bruker
  const admin = await prisma.bruker.findFirst({
    where:  { rolle: { in: ['admin', 'tenantadmin'] }, erAktiv: true },
    select: { entraObjectId: true, displayName: true, rolle: true },
  });
  if (!admin) {
    console.error('Ingen admin-bruker funnet i Prisma. Avbryter.');
    process.exit(1);
  }
  console.log(`Admin-bruker: ${admin.displayName} (${admin.rolle})\n`);

  // Hent ikke-admin (om mulig — ellers skip 403-test)
  const ikkeAdmin = await prisma.bruker.findFirst({
    where:  { rolle: { notIn: ['admin', 'tenantadmin'] }, erAktiv: true },
    select: { entraObjectId: true, displayName: true, rolle: true },
  });
  if (ikkeAdmin) console.log(`Ikke-admin:   ${ikkeAdmin.displayName} (${ikkeAdmin.rolle})\n`);

  const resultater: SjekkResultat[] = [];

  // ── 401 anonymt ──────────────────────────────────────────────────────
  const anon = await hent('/api/admin/slicer-indeks');
  resultater.push(verifiserStatus('GET /slicer-indeks anonym → 401', anon.status, 401));

  // ── 403 ikke-admin ───────────────────────────────────────────────────
  if (ikkeAdmin) {
    const r = await hent('/api/admin/slicer-indeks', { entraId: ikkeAdmin.entraObjectId });
    resultater.push(verifiserStatus(`GET /slicer-indeks som ${ikkeAdmin.rolle} → 403`, r.status, 403));
  } else {
    console.log('(Hopper 403-test — ingen ikke-admin-bruker funnet)\n');
  }

  // ── 200 admin: list ──────────────────────────────────────────────────
  const list = await hent('/api/admin/slicer-indeks', { entraId: admin.entraObjectId });
  const erArray = Array.isArray(list.body);
  resultater.push({
    navn:      'GET /slicer-indeks som admin → 200 + array',
    forventet: 'HTTP 200 + array',
    faktisk:   `HTTP ${list.status} + ${erArray ? `array(${(list.body as unknown[]).length})` : typeof list.body}`,
    ok:        list.status === 200 && erArray,
  });

  // ── 200 admin: rapporter-med-slicere ─────────────────────────────────
  const rapps = await hent('/api/admin/rapporter-med-slicere', { entraId: admin.entraObjectId });
  const rappsErArr = Array.isArray(rapps.body);
  resultater.push({
    navn:      'GET /rapporter-med-slicere → 200 + array',
    forventet: 'HTTP 200 + array',
    faktisk:   `HTTP ${rapps.status} + ${rappsErArr ? `array(${(rapps.body as unknown[]).length})` : typeof rapps.body}`,
    ok:        rapps.status === 200 && rappsErArr,
  });

  // ── 200 admin: forslag ───────────────────────────────────────────────
  const forslag = await hent('/api/admin/slicer-indeks/forslag', { entraId: admin.entraObjectId });
  const harForslagShape =
    forslag.body !== null &&
    typeof forslag.body === 'object' &&
    'trenger_reindeksering' in (forslag.body as object) &&
    'rapporter_uten_konfig'  in (forslag.body as object);
  resultater.push({
    navn:      'GET /slicer-indeks/forslag → 200 + struktur',
    forventet: 'HTTP 200 + { trenger_reindeksering, rapporter_uten_konfig }',
    faktisk:   `HTTP ${forslag.status}` + (harForslagShape ? ' + riktig shape' : ' + feil shape'),
    ok:        forslag.status === 200 && harForslagShape,
  });

  // ── 404 admin: ikke-eksisterende ID ──────────────────────────────────
  const ikkeFunnet = await hent('/api/admin/slicer-indeks/00000000-0000-0000-0000-000000000000', {
    entraId: admin.entraObjectId,
  });
  resultater.push(verifiserStatus('GET /slicer-indeks/<bogus> → 404', ikkeFunnet.status, 404));

  // ── Tabeller-endepunkt: 400 hvis INFO.TABLES ikke støttes, 200 ellers
  const enRapport = (rapps.body as Array<{ pbiWorkspaceId: string; pbiDatasetId: string }>)?.[0];
  if (enRapport?.pbiWorkspaceId && enRapport.pbiDatasetId) {
    const tab = await hent(
      `/api/admin/datasets/${enRapport.pbiWorkspaceId}/${enRapport.pbiDatasetId}/tabeller`,
      { entraId: admin.entraObjectId },
    );
    resultater.push({
      navn:      `GET /datasets/<ws>/<ds>/tabeller → 200 eller 400`,
      forventet: '200 (INFO.TABLES støttet) eller 400 (graceful fallback)',
      faktisk:   `HTTP ${tab.status}`,
      ok:        tab.status === 200 || tab.status === 400,
      detalj:    JSON.stringify(tab.body).slice(0, 200),
    });
  }

  // ── Resultat ─────────────────────────────────────────────────────────
  console.log('\n───────────────────────────────────────────────────');
  for (const r of resultater) {
    console.log(`[${r.ok ? '✓' : '✗'}] ${r.navn}`);
    console.log(`     forventet: ${r.forventet}`);
    console.log(`     faktisk:   ${r.faktisk}`);
    if (r.detalj && !r.ok) console.log(`     detalj:    ${r.detalj}`);
  }
  const passert = resultater.filter((r) => r.ok).length;
  console.log('───────────────────────────────────────────────────');
  console.log(`${passert}/${resultater.length} sjekker passert\n`);

  if (passert !== resultater.length) process.exit(1);
}

main()
  .catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
