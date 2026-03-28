import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireBruker, requireAdmin, resolveBruker } from '../middleware/auth';
import { queryAzureSQL } from '../services/azureSqlService';

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2025'
  );
}

interface CreateRapportBody {
  navn: string;
  beskrivelse?: string;
  pbiReportId: string;
  pbiDatasetId: string;
  pbiWorkspaceId: string;
}

interface LinkRapportBody {
  rapportId: string;
}

const workspaceSelect = { select: { id: true, navn: true } };

export async function rapportRoutes(fastify: FastifyInstance) {
  // ── Globale rapport-ruter ──────────────────────────────────────────────────

  // GET /api/rapporter
  fastify.get('/api/rapporter', async (_request, reply) => {
    try {
      const rapporter = await prisma.rapport.findMany({
        where: { erAktiv: true },
        include: {
          workspaces: { include: { workspace: workspaceSelect } },
        },
        orderBy: { opprettetDato: 'desc' },
      });
      return reply.send(rapporter);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Kunne ikke hente rapporter.' });
    }
  });

  // GET /api/rapporter/:id
  fastify.get<{ Params: { id: string } }>(
    '/api/rapporter/:id',
    async (request, reply) => {
      try {
        const id = request.params.id.replace(/[^a-zA-Z0-9\-]/g, '');
        const rapport = await prisma.rapport.findUnique({
          where: { id },
          include: {
            workspaces: { include: { workspace: workspaceSelect } },
          },
        });
        if (!rapport) return reply.status(404).send({ error: 'Rapport ikke funnet.' });

        // Hent erDesignerRapport via raw SQL (kolonnen finnes ikke i Prisma-schema)
        let erDesignerRapport = false;
        try {
          const rows = await queryAzureSQL(`SELECT erDesignerRapport FROM Rapport WHERE id = '${id}'`);
          erDesignerRapport = Boolean((rows[0] as { erDesignerRapport?: unknown } | undefined)?.erDesignerRapport);
        } catch { /* kolonnen finnes ikke ennå */ }

        return reply.send({ ...rapport, erDesignerRapport });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke hente rapport.' });
      }
    }
  );

  // POST /api/rapporter
  fastify.post<{ Body: CreateRapportBody }>(
    '/api/rapporter',
    {
      schema: {
        body: {
          type: 'object',
          required: ['navn', 'pbiReportId', 'pbiDatasetId', 'pbiWorkspaceId'],
          properties: {
            navn:           { type: 'string', minLength: 1 },
            beskrivelse:    { type: 'string' },
            pbiReportId:    { type: 'string', minLength: 1 },
            pbiDatasetId:   { type: 'string', minLength: 1 },
            pbiWorkspaceId: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const rapport = await prisma.rapport.create({ data: request.body });
        return reply.status(201).send(rapport);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke opprette rapport.' });
      }
    }
  );

  // PUT /api/rapporter/:id  (oppdater rapportnavn og metadata)
  fastify.put<{
    Params: { id: string };
    Body: { navn: string; område?: string | null; beskrivelse?: string | null; nøkkelord?: string | null };
  }>(
    '/api/rapporter/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['navn'],
          properties: {
            navn:        { type: 'string', minLength: 1 },
            område:      { type: ['string', 'null'] },
            beskrivelse: { type: ['string', 'null'] },
            nøkkelord:   { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const { navn, område, beskrivelse, nøkkelord } = request.body;
        const rapport = await prisma.rapport.update({
          where: { id: request.params.id },
          data: {
            navn:        navn.trim(),
            område:      område?.trim() || null,
            beskrivelse: beskrivelse?.trim() || null,
            nøkkelord:   nøkkelord?.trim() || null,
          },
        });
        return reply.send(rapport);
      } catch (error) {
        if (isNotFound(error)) return reply.status(404).send({ error: 'Rapport ikke funnet.' });
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke oppdatere rapport.' });
      }
    }
  );

  // DELETE /api/rapporter/:id  (sletter rapporten globalt, WorkspaceRapport-koblinger følger via cascade)
  fastify.delete<{ Params: { id: string } }>(
    '/api/rapporter/:id',
    async (request, reply) => {
      try {
        await prisma.rapport.delete({ where: { id: request.params.id } });
        return reply.status(204).send();
      } catch (error) {
        if (isNotFound(error)) return reply.status(404).send({ error: 'Rapport ikke funnet.' });
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke slette rapport.' });
      }
    }
  );

  // GET /api/rapporter/:id/views — views koblet til rapporten (for designer-opprettelse)
  // Returnerer KUN views eksplisitt koblet til denne rapporten — aldri fallback til alle views.
  fastify.get<{ Params: { id: string } }>(
    '/api/rapporter/:id/views',
    { preHandler: [requireBruker] },
    async (request, reply) => {
      const rapportId = request.params.id.replace(/[^a-zA-Z0-9\-]/g, '');
      console.log(`[Views API] henter views for rapport: ${rapportId}`);
      try {
        const rows = await queryAzureSQL(`
          SELECT v.id, v.schema_name, v.view_name, v.visningsnavn,
                 v.prosjekt_kolonne,
                 COALESCE(v.prosjekt_kolonne_type, 'number') AS prosjekt_kolonne_type
          FROM ai_metadata_views v
          JOIN ai_rapport_view_kobling k ON k.view_id = v.id
          WHERE k.rapport_id = '${rapportId}' AND v.er_aktiv = 1
          ORDER BY v.visningsnavn
        `);
        console.log(`[Views API] rapport: ${rapportId} → ${rows.length} views funnet`);
        if (rows.length > 0) console.log(`[Views API] første view:`, JSON.stringify(rows[0]));
        return reply.send({ views: rows });
      } catch (err) {
        console.error('[Views API] SQL-feil:', err);
        return reply.status(500).send({ views: [], feil: String(err) });
      }
    },
  );

  // GET /api/admin/rapporter/alle — alle aktive rapporter med workspace-navn (for admin dropdowns)
  fastify.get(
    '/api/admin/rapporter/alle',
    { preHandler: [requireBruker, requireAdmin] },
    async (_request, reply) => {
      try {
        const rapporter = await prisma.rapport.findMany({
          where: { erAktiv: true },
          select: {
            id: true,
            navn: true,
            område: true,
            workspaces: { select: { workspace: { select: { navn: true } } }, take: 1 },
          },
          orderBy: { navn: 'asc' },
        });
        return reply.send(rapporter.map(r => ({
          id:             r.id,
          navn:           r.navn,
          område:         r.område,
          workspace_navn: r.workspaces[0]?.workspace?.navn ?? null,
        })));
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke hente rapporter.' });
      }
    },
  );

  // DELETE /api/admin/rapporter/:id  (soft delete — setter erAktiv = false, bevarer historikk)
  fastify.delete<{ Params: { id: string } }>(
    '/api/admin/rapporter/:id',
    async (request, reply) => {
      try {
        await prisma.rapport.update({
          where: { id: request.params.id },
          data:  { erAktiv: false },
        });
        return reply.status(204).send();
      } catch (error) {
        if (isNotFound(error)) return reply.status(404).send({ error: 'Rapport ikke funnet.' });
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke deaktivere rapport.' });
      }
    }
  );

  // ── Workspace-koblede rapport-ruter ────────────────────────────────────────

  // GET /api/workspaces/:id/rapporter
  fastify.get<{ Params: { id: string }; Querystring: { grupper?: string } }>(
    '/api/workspaces/:id/rapporter',
    async (request, reply) => {
      try {
        const workspace = await prisma.workspace.findUnique({
          where: { id: request.params.id },
          select: { id: true, opprettetAv: true },
        });
        if (!workspace) return reply.status(404).send({ error: 'Workspace ikke funnet.' });

        const bruker = await resolveBruker(request);
        const isAdmin = bruker?.rolle === 'admin';
        const entraId = bruker?.entraObjectId;
        const grupperArray = request.query.grupper ? request.query.grupper.split(',').filter(Boolean) : [];
        const identities = [...(entraId ? [entraId] : []), ...grupperArray];

        // Hjelpefunksjon: legg til erDesignerRapport på rapporter
        async function medDesignerFlagg(rapporter: { id: string }[]): Promise<object[]> {
          if (rapporter.length === 0) return rapporter;
          const ids = rapporter.map((r) => `'${r.id.replace(/[^a-zA-Z0-9\-]/g, '')}'`).join(',');
          let flagMap = new Map<string, boolean>();
          try {
            const rows = await queryAzureSQL(`SELECT id, erDesignerRapport FROM Rapport WHERE id IN (${ids})`);
            flagMap = new Map(rows.map((row) => [(row as { id: string }).id.toLowerCase(), Boolean((row as { erDesignerRapport: unknown }).erDesignerRapport)]));
          } catch { /* kolonnen finnes ikke ennå */ }
          return rapporter.map((r) => ({ ...r, erDesignerRapport: flagMap.get(r.id.toLowerCase()) ?? false }));
        }

        // Admin eller ingen identitet → returner alle (admin-verktøy o.l.)
        if (isAdmin || identities.length === 0) {
          const links = await prisma.workspaceRapport.findMany({
            where: { workspaceId: request.params.id, rapport: { erAktiv: true } },
            include: { rapport: true },
            orderBy: { rekkefølge: 'asc' },
          });
          return reply.send(await medDesignerFlagg(links.map((l) => l.rapport)));
        }

        // Sjekk tilgang via råSQL — dekker Tilgang-tabell, workspace-eier og personlig workspace
        const safeWsId    = request.params.id.replace(/[^a-zA-Z0-9\-]/g, '');
        const inClause    = identities.map((i) => `'${i.replace(/[^a-zA-Z0-9\-]/g, '')}'`).join(',');
        let harTilgang    = false;
        try {
          const tilgangRows = await queryAzureSQL(`
            SELECT 1 AS har_tilgang FROM Tilgang
            WHERE workspaceId = '${safeWsId}' AND entraId IN (${inClause})
            UNION
            SELECT 1 FROM Workspace w
            JOIN bruker b ON b.id = w.opprettetAv
            WHERE w.id = '${safeWsId}' AND b.entraObjectId IN (${inClause})
            UNION
            SELECT 1 FROM bruker
            WHERE entraObjectId IN (${inClause}) AND mittWorkspaceId = '${safeWsId}'
          `);
          harTilgang = tilgangRows.length > 0;
        } catch (err) {
          // Fallback: Prisma-sjekk
          const p = await prisma.tilgang.findFirst({
            where: { workspaceId: request.params.id, entraId: { in: identities } },
            select: { id: true },
          });
          harTilgang = p !== null || (bruker !== null && workspace.opprettetAv === bruker.id);
        }

        console.log(
          `[rapporter/:id/rapporter] wsId=${safeWsId} | identities=${identities.length}` +
          ` | harTilgang=${harTilgang} | opprettetAv=${workspace.opprettetAv} | brukerId=${bruker?.id ?? 'null'}`,
        );

        if (harTilgang) {
          // Direkte workspace-tilgang: vis alle rapporter uten begrensning + eksplisitt tillatte
          const links = await prisma.workspaceRapport.findMany({
            where: { workspaceId: request.params.id, rapport: { erAktiv: true } },
            include: { rapport: { include: { tilgang: { select: { entraId: true } } } } },
            orderBy: { rekkefølge: 'asc' },
          });
          const filtrerte = links
            .filter((l) => {
              const t = l.rapport.tilgang ?? [];
              if (t.length === 0) return true; // arver workspace-tilgang
              return t.some((r) => identities.includes(r.entraId));
            })
            .map((l) => {
              const { tilgang: _t, ...rapport } = l.rapport;
              return rapport;
            });
          console.log(`[rapporter/:id/rapporter] tilgang-path: total=${links.length} filtrert=${filtrerte.length}`);
          return reply.send(await medDesignerFlagg(filtrerte));
        }

        // Kun rapport-tilgang: vis bare rapporter med eksplisitt tilgang
        const links = await prisma.workspaceRapport.findMany({
          where: {
            workspaceId: request.params.id,
            rapport: {
              erAktiv: true,
              tilgang: { some: { entraId: { in: identities } } },
            },
          },
          include: { rapport: true },
          orderBy: { rekkefølge: 'asc' },
        });
        console.log(`[rapporter/:id/rapporter] kun-rapport-tilgang: total=${links.length}`);
        return reply.send(await medDesignerFlagg(links.map((l) => l.rapport)));
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke hente rapporter.' });
      }
    }
  );

  // POST /api/workspaces/:id/rapporter  (koble eksisterende rapport til workspace)
  fastify.post<{ Params: { id: string }; Body: LinkRapportBody }>(
    '/api/workspaces/:id/rapporter',
    {
      schema: {
        body: {
          type: 'object',
          required: ['rapportId'],
          properties: {
            rapportId: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const workspace = await prisma.workspace.findUnique({
          where: { id: request.params.id },
          select: { id: true },
        });
        if (!workspace) return reply.status(404).send({ error: 'Workspace ikke funnet.' });

        const rapport = await prisma.rapport.findUnique({
          where: { id: request.body.rapportId, erAktiv: true },
          select: { id: true },
        });
        if (!rapport) return reply.status(404).send({ error: 'Rapport ikke funnet.' });

        const link = await prisma.workspaceRapport.create({
          data: { workspaceId: request.params.id, rapportId: request.body.rapportId },
          include: { rapport: true },
        });
        return reply.status(201).send(link);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke koble rapport til workspace.' });
      }
    }
  );

  // DELETE /api/workspaces/:id/rapporter/:rapportId  (fjerner KUN koblingen, ikke selve rapporten)
  fastify.delete<{ Params: { id: string; rapportId: string } }>(
    '/api/workspaces/:id/rapporter/:rapportId',
    async (request, reply) => {
      try {
        await prisma.workspaceRapport.delete({
          where: {
            workspaceId_rapportId: {
              workspaceId: request.params.id,
              rapportId: request.params.rapportId,
            },
          },
        });
        return reply.status(204).send();
      } catch (error) {
        if (isNotFound(error)) return reply.status(404).send({ error: 'Kobling ikke funnet.' });
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke fjerne kobling.' });
      }
    }
  );
}
