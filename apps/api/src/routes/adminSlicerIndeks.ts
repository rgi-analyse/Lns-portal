/**
 * Admin-endepunkter for å administrere slicer-indekserings-konfigurasjoner.
 *
 * Alle endepunkter krever rolle 'admin' eller 'tenantadmin'. Multi-tenant-klar
 * via tenantSlug fra resolveTenant.
 */

import type { FastifyInstance } from 'fastify';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';
import { resolveBruker, requireBruker, requireAdmin } from '../middleware/auth';
import { utførDax } from '../services/pbiQueryService';
import { indekserSlicer } from '../services/slicerIndekseringService';
import { slettAlleForSlicer } from '../services/slicerKatalogService';
import { prisma } from '../lib/prisma';

interface OpprettBody {
  rapport_id:        string;
  slicer_tittel:     string;
  slicer_type:       'basic' | 'hierarchy';
  tabell:            string;
  verdi_kolonne:     string;
  forelder_kolonne?: string;
}

interface OppdaterBody {
  slicer_type?:      'basic' | 'hierarchy';
  tabell?:           string;
  verdi_kolonne?:    string;
  forelder_kolonne?: string | null;
  er_aktiv?:         boolean;
}

const PRE = [resolveTenant, resolveBruker, requireBruker, requireAdmin];

/** Bygg DAX ut fra type + tabell + kolonner. Felles for opprett og oppdater. */
function byggDax(
  type:           'basic' | 'hierarchy',
  tabell:         string,
  verdiKolonne:   string,
  forelderKolonne?: string | null,
): string {
  if (type === 'basic') {
    return `EVALUATE\nDISTINCT('${tabell}'[${verdiKolonne}])\nORDER BY [${verdiKolonne}]`;
  }
  if (!forelderKolonne) {
    throw new Error('hierarchy krever forelder_kolonne');
  }
  return (
    `EVALUATE\nSUMMARIZE(\n  '${tabell}',\n  '${tabell}'[${forelderKolonne}],\n  '${tabell}'[${verdiKolonne}]\n)` +
    `\nORDER BY [${forelderKolonne}], [${verdiKolonne}]`
  );
}

/** Parse fully-qualified kolonne ('tabell[kolonne]') til { tabell, kolonne }. */
function parseFqKolonne(fq: string | null | undefined): { tabell: string; kolonne: string } | null {
  if (!fq) return null;
  const m = fq.match(/^(.+)\[([^\]]+)\]$/);
  if (!m) return null;
  return { tabell: m[1], kolonne: m[2] };
}

export async function adminSlicerIndeksRoutes(fastify: FastifyInstance) {
  // ── 1. GET /api/admin/slicer-indeks — list alle ──────────────────────
  fastify.get(
    '/api/admin/slicer-indeks',
    { preHandler: PRE },
    async (request, reply) => {
      const tenant = (request as TenantRequest).tenantSlug;
      if (!tenant) return reply.status(400).send({ error: 'Mangler tenant-kontekst.' });

      const konfiger = await prisma.slicerIndeksering.findMany({
        where:   { tenant },
        orderBy: [{ sist_indeksert: 'desc' }],
      });

      // Slå opp rapport-navn i tenant-DB
      const rapportIds = [...new Set(konfiger.map((k) => k.rapport_id))];
      const rapporter  = rapportIds.length > 0
        ? await (request as TenantRequest).tenantPrisma.rapport.findMany({
            where:  { id: { in: rapportIds } },
            select: { id: true, navn: true },
          })
        : [];
      const navnPerId = new Map(rapporter.map((r) => [r.id, r.navn]));

      return reply.send(konfiger.map((k) => ({
        id:                k.id,
        rapport_id:        k.rapport_id,
        rapport_navn:      navnPerId.get(k.rapport_id) ?? null,
        slicer_tittel:     k.slicer_tittel,
        slicer_type:       k.slicer_type,
        sist_indeksert:    k.sist_indeksert,
        sist_antall_rader: k.sist_antall_rader,
        er_aktiv:          k.er_aktiv,
      })).sort((a, b) => {
        // sist_indeksert DESC (null sist), så rapport_navn ASC
        const aT = a.sist_indeksert?.getTime() ?? 0;
        const bT = b.sist_indeksert?.getTime() ?? 0;
        if (aT !== bT) return bT - aT;
        return (a.rapport_navn ?? '').localeCompare(b.rapport_navn ?? '');
      }));
    },
  );

  // ── 2. GET /api/admin/slicer-indeks/:id — detalj ─────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/api/admin/slicer-indeks/:id',
    { preHandler: PRE },
    async (request, reply) => {
      const tenant = (request as TenantRequest).tenantSlug;
      const k = await prisma.slicerIndeksering.findFirst({
        where: { id: request.params.id, tenant },
      });
      if (!k) return reply.status(404).send({ error: 'Konfig ikke funnet.' });

      const rapport = await (request as TenantRequest).tenantPrisma.rapport.findUnique({
        where:  { id: k.rapport_id },
        select: { id: true, navn: true },
      });

      return reply.send({ ...k, rapport_navn: rapport?.navn ?? null });
    },
  );

  // ── 3. POST /api/admin/slicer-indeks — opprett ───────────────────────
  fastify.post<{ Body: OpprettBody }>(
    '/api/admin/slicer-indeks',
    {
      preHandler: PRE,
      schema: {
        body: {
          type: 'object',
          required: ['rapport_id', 'slicer_tittel', 'slicer_type', 'tabell', 'verdi_kolonne'],
          properties: {
            rapport_id:       { type: 'string', minLength: 1 },
            slicer_tittel:    { type: 'string', minLength: 1 },
            slicer_type:      { type: 'string', enum: ['basic', 'hierarchy'] },
            tabell:           { type: 'string', minLength: 1 },
            verdi_kolonne:    { type: 'string', minLength: 1 },
            forelder_kolonne: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const tenant = (request as TenantRequest).tenantSlug;
      if (!tenant) return reply.status(400).send({ error: 'Mangler tenant-kontekst.' });
      const { rapport_id, slicer_tittel, slicer_type, tabell, verdi_kolonne, forelder_kolonne } = request.body;

      if (slicer_type === 'hierarchy' && !forelder_kolonne) {
        return reply.status(400).send({ error: 'hierarchy krever forelder_kolonne.' });
      }
      if (slicer_type === 'basic' && forelder_kolonne) {
        return reply.status(400).send({ error: 'basic skal ikke ha forelder_kolonne.' });
      }

      const rapport = await (request as TenantRequest).tenantPrisma.rapport.findUnique({
        where:  { id: rapport_id },
        select: { id: true, pbiWorkspaceId: true, pbiDatasetId: true },
      });
      if (!rapport) return reply.status(404).send({ error: 'Rapport ikke funnet.' });

      const dax_query        = byggDax(slicer_type, tabell, verdi_kolonne, forelder_kolonne);
      const verdiKolonneFq   = `${tabell}[${verdi_kolonne}]`;
      const forelderKolonneFq = forelder_kolonne ? `${tabell}[${forelder_kolonne}]` : null;

      const lagret = await prisma.slicerIndeksering.upsert({
        where: { tenant_rapport_id_slicer_tittel: { tenant, rapport_id, slicer_tittel } },
        create: {
          tenant, rapport_id, slicer_tittel, slicer_type,
          workspace_id:     rapport.pbiWorkspaceId,
          dataset_id:       rapport.pbiDatasetId,
          dax_query,
          verdi_kolonne:    verdiKolonneFq,
          forelder_kolonne: forelderKolonneFq,
          er_aktiv:         true,
        },
        update: {
          slicer_type, dax_query,
          workspace_id:     rapport.pbiWorkspaceId,
          dataset_id:       rapport.pbiDatasetId,
          verdi_kolonne:    verdiKolonneFq,
          forelder_kolonne: forelderKolonneFq,
          er_aktiv:         true,
        },
      });

      return reply.status(201).send(lagret);
    },
  );

  // ── 4. PUT /api/admin/slicer-indeks/:id — oppdater ───────────────────
  fastify.put<{ Params: { id: string }; Body: OppdaterBody }>(
    '/api/admin/slicer-indeks/:id',
    {
      preHandler: PRE,
      schema: {
        body: {
          type: 'object',
          properties: {
            slicer_type:      { type: 'string', enum: ['basic', 'hierarchy'] },
            tabell:           { type: 'string' },
            verdi_kolonne:    { type: 'string' },
            forelder_kolonne: { type: ['string', 'null'] },
            er_aktiv:         { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const tenant = (request as TenantRequest).tenantSlug;
      const eksisterende = await prisma.slicerIndeksering.findFirst({
        where: { id: request.params.id, tenant },
      });
      if (!eksisterende) return reply.status(404).send({ error: 'Konfig ikke funnet.' });

      // Splitt eksisterende fully-qualified kolonner for mulig overstyring
      const eksTabell = parseFqKolonne(eksisterende.verdi_kolonne)?.tabell ?? null;
      const eksVerdi  = parseFqKolonne(eksisterende.verdi_kolonne)?.kolonne ?? null;
      const eksForelder = parseFqKolonne(eksisterende.forelder_kolonne)?.kolonne ?? null;

      const nyType    = request.body.slicer_type   ?? eksisterende.slicer_type;
      const nyTabell  = request.body.tabell        ?? eksTabell;
      const nyVerdi   = request.body.verdi_kolonne ?? eksVerdi;
      const nyForelder: string | null = request.body.forelder_kolonne === undefined
        ? eksForelder
        : request.body.forelder_kolonne;

      if (nyType === 'hierarchy' && !nyForelder) {
        return reply.status(400).send({ error: 'hierarchy krever forelder_kolonne.' });
      }
      if (!nyTabell || !nyVerdi) {
        return reply.status(400).send({ error: 'Mangler tabell eller verdi_kolonne.' });
      }

      const dax_query = byggDax(
        nyType as 'basic' | 'hierarchy',
        nyTabell,
        nyVerdi,
        nyType === 'hierarchy' ? nyForelder! : undefined,
      );

      const oppdatert = await prisma.slicerIndeksering.update({
        where: { id: request.params.id },
        data: {
          slicer_type:      nyType,
          dax_query,
          verdi_kolonne:    `${nyTabell}[${nyVerdi}]`,
          forelder_kolonne: nyForelder ? `${nyTabell}[${nyForelder}]` : null,
          ...(request.body.er_aktiv !== undefined ? { er_aktiv: request.body.er_aktiv } : {}),
        },
      });

      return reply.send(oppdatert);
    },
  );

  // ── 5. DELETE /api/admin/slicer-indeks/:id ───────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/api/admin/slicer-indeks/:id',
    { preHandler: PRE },
    async (request, reply) => {
      const tenant = (request as TenantRequest).tenantSlug;
      const k = await prisma.slicerIndeksering.findFirst({
        where: { id: request.params.id, tenant },
      });
      if (!k) return reply.status(404).send({ error: 'Konfig ikke funnet.' });

      // Rydd opp i AI Search først — så DB-konfig hvis det lyktes
      let antallSlettet = 0;
      try {
        antallSlettet = await slettAlleForSlicer(k.tenant, k.rapport_id, k.slicer_tittel);
      } catch (err) {
        request.log.warn({ err }, '[admin] kunne ikke slette søke-dokumenter; fortsetter med DB-slett');
      }

      await prisma.slicerIndeksering.delete({ where: { id: k.id } });
      return reply.send({ slettet: true, indeks_dokumenter_slettet: antallSlettet });
    },
  );

  // ── 6. POST /api/admin/slicer-indeks/:id/indekser ────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/api/admin/slicer-indeks/:id/indekser',
    { preHandler: PRE },
    async (request, reply) => {
      const tenant = (request as TenantRequest).tenantSlug;
      const k = await prisma.slicerIndeksering.findFirst({
        where: { id: request.params.id, tenant },
      });
      if (!k) return reply.status(404).send({ error: 'Konfig ikke funnet.' });
      if (!k.er_aktiv) return reply.status(400).send({ error: 'Konfig er inaktiv. Aktiver den først.' });

      try {
        const r = await indekserSlicer(k.id);
        return reply.send({
          slicer_tittel:    r.slicer_tittel,
          antall_rader:     r.antall_rader,
          dax_ms:           r.spørrings_ms,
          indeks_ms:        r.indekserings_ms,
        });
      } catch (err) {
        const melding = err instanceof Error ? err.message : 'Ukjent feil under indeksering.';
        return reply.status(500).send({ error: melding });
      }
    },
  );

  // ── 7. GET /api/admin/rapporter-med-slicere ──────────────────────────
  fastify.get(
    '/api/admin/rapporter-med-slicere',
    { preHandler: PRE },
    async (request, reply) => {
      const tenant = (request as TenantRequest).tenantSlug;
      if (!tenant) return reply.status(400).send({ error: 'Mangler tenant.' });

      const rapporter = await (request as TenantRequest).tenantPrisma.rapport.findMany({
        where:   { erAktiv: true },
        select: {
          id: true, navn: true, område: true,
          pbiReportId: true, pbiWorkspaceId: true, pbiDatasetId: true,
        },
        orderBy: { navn: 'asc' },
      });

      // Hent antall aktive konfig-er per rapport
      const counts = await prisma.slicerIndeksering.groupBy({
        by:    ['rapport_id'],
        where: { tenant, er_aktiv: true },
        _count: true,
      });
      const countPerId = new Map(counts.map((c) => [c.rapport_id, c._count]));

      return reply.send(rapporter.map((r) => ({
        id:                r.id,
        navn:              r.navn,
        område:            r.område,
        pbiReportId:       r.pbiReportId,
        pbiWorkspaceId:    r.pbiWorkspaceId,
        pbiDatasetId:      r.pbiDatasetId,
        antall_slicere:    null,    // ikke pre-analysert — frontend kan supplementere via PowerBIReport
        antall_indekserte: countPerId.get(r.id) ?? 0,
      })));
    },
  );

  // ── 8. GET /api/admin/rapporter/:id/slicere ──────────────────────────
  // Returnerer alle konfigurerte slicere for én rapport. UI henter
  // ikke-konfigurerte slicere fra PowerBIReport.loadAll på frontend.
  fastify.get<{ Params: { id: string } }>(
    '/api/admin/rapporter/:id/slicere',
    { preHandler: PRE },
    async (request, reply) => {
      const tenant = (request as TenantRequest).tenantSlug;
      if (!tenant) return reply.status(400).send({ error: 'Mangler tenant.' });

      // Bekreft at rapporten finnes i tenant-DB
      const rapport = await (request as TenantRequest).tenantPrisma.rapport.findUnique({
        where:  { id: request.params.id },
        select: { id: true },
      });
      if (!rapport) return reply.status(404).send({ error: 'Rapport ikke funnet.' });

      const konfiger = await prisma.slicerIndeksering.findMany({
        where:   { tenant, rapport_id: request.params.id },
        orderBy: { slicer_tittel: 'asc' },
      });

      return reply.send(konfiger.map((k) => ({
        tittel:             k.slicer_tittel,
        type:               k.slicer_type,
        konfig_id:          k.id,
        allerede_indeksert: k.er_aktiv && !!k.sist_indeksert,
        er_aktiv:           k.er_aktiv,
        sist_indeksert:     k.sist_indeksert,
        sist_antall_rader:  k.sist_antall_rader,
        verdi_kolonne:      k.verdi_kolonne,
        forelder_kolonne:   k.forelder_kolonne,
      })));
    },
  );

  // ── 10. GET /api/admin/slicer-indeks/forslag ─────────────────────────
  // Pragmatisk versjon: backend kan ikke enumerere ikke-indekserte slicere
  // uten frontend-discovery (PBI report-layout er ikke tilgjengelig via SP).
  // Endepunktet leverer i stedet to lister UI kan bruke som forslag-kilde:
  //   1. trenger_reindeksering — konfig-er eldre enn 24 timer
  //   2. rapporter_uten_konfig — rapporter med 0 aktive konfig-er
  // UI utvider dette med discovered slicers fra PowerBIReport.loadAll når
  // admin åpner en rapport.
  fastify.get(
    '/api/admin/slicer-indeks/forslag',
    { preHandler: PRE },
    async (request, reply) => {
      const tenant = (request as TenantRequest).tenantSlug;
      if (!tenant) return reply.status(400).send({ error: 'Mangler tenant.' });

      // 1. Konfig-er som trenger reindeksering (eldre enn 24t eller aldri kjørt)
      const ettDøgnSiden = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const trenger = await prisma.slicerIndeksering.findMany({
        where: {
          tenant, er_aktiv: true,
          OR: [
            { sist_indeksert: null },
            { sist_indeksert: { lt: ettDøgnSiden } },
          ],
        },
        orderBy: [{ sist_indeksert: 'asc' }],
      });

      // 2. Rapporter uten konfig
      const aktiveRapporter = await (request as TenantRequest).tenantPrisma.rapport.findMany({
        where:  { erAktiv: true },
        select: { id: true, navn: true, område: true },
      });
      const konfigPerRapport = await prisma.slicerIndeksering.groupBy({
        by:     ['rapport_id'],
        where:  { tenant, er_aktiv: true },
        _count: true,
      });
      const harKonfig = new Set(konfigPerRapport.map((c) => c.rapport_id));
      const utenKonfig = aktiveRapporter
        .filter((r) => !harKonfig.has(r.id))
        .map((r) => ({ id: r.id, navn: r.navn, område: r.område }));

      // Slå opp rapport-navn for trenger-reindeksering
      const navnPerId = new Map(aktiveRapporter.map((r) => [r.id, r.navn]));

      return reply.send({
        merknad:
          'Backend kan ikke automatisk oppdage ikke-indekserte slicere uten frontend-discovery. ' +
          'UI bør supplementere med PowerBIReport.loadAll for å oppdage nye kandidater per rapport.',
        trenger_reindeksering: trenger.map((k) => ({
          konfig_id:         k.id,
          rapport_id:        k.rapport_id,
          rapport_navn:      navnPerId.get(k.rapport_id) ?? null,
          slicer_tittel:     k.slicer_tittel,
          slicer_type:       k.slicer_type,
          sist_indeksert:    k.sist_indeksert,
          sist_antall_rader: k.sist_antall_rader,
        })),
        rapporter_uten_konfig: utenKonfig,
      });
    },
  );

  // ── 9. GET /api/admin/datasets/:workspace_id/:dataset_id/tabeller ────
  // Lister tabeller i et PBI-datasett via DAX INFO.TABLES (krever moderne
  // PBI-tenant). Med ?tabell=<navn> hentes kolonner for én tabell via TOPN.
  fastify.get<{
    Params:      { workspace_id: string; dataset_id: string };
    Querystring: { tabell?: string };
  }>(
    '/api/admin/datasets/:workspace_id/:dataset_id/tabeller',
    { preHandler: PRE },
    async (request, reply) => {
      const { workspace_id, dataset_id } = request.params;
      const { tabell } = request.query;

      // Modus 1: hent kolonner for spesifikk tabell
      if (tabell) {
        try {
          const r = await utførDax({
            workspaceId: workspace_id,
            datasetId:   dataset_id,
            dax:         `EVALUATE TOPN(1, '${tabell}')`,
          });
          if (r.rader.length === 0) {
            return reply.send({ tabell, kolonner: [], antall_rader: 0 });
          }
          const kolonner = Object.keys(r.rader[0]).map((k) => {
            const m = k.match(/\[([^\]]+)\]$/);
            return { navn: m ? m[1] : k, fully_qualified: k };
          });
          return reply.send({ tabell, kolonner });
        } catch (err) {
          return reply.status(400).send({
            error:  `Kunne ikke lese tabellen "${tabell}".`,
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Modus 2: list alle tabeller (forsøk INFO.TABLES — fallback til feilmelding)
      try {
        const r = await utførDax({
          workspaceId: workspace_id,
          datasetId:   dataset_id,
          dax: `EVALUATE
SELECTCOLUMNS(
  FILTER(INFO.TABLES(), [IsHidden] = FALSE),
  "Name", [Name]
)`,
        });
        const tabeller = r.rader
          .map((rad) => (rad['[Name]'] ?? rad['Name'] ?? '') as string)
          .filter((navn) => navn.length > 0)
          .map((navn) => ({ navn }));
        return reply.send({ tabeller });
      } catch (err) {
        return reply.status(400).send({
          error:
            'Kan ikke liste tabeller automatisk — datasettet støtter ikke INFO.TABLES(). ' +
            'Oppgi tabellnavn via ?tabell=<navn> for å hente kolonner.',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
