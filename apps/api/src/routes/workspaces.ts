import type { FastifyInstance } from 'fastify';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';
import { resolveBruker, erAdmin } from '../middleware/auth';
import { queryAzureSQL } from '../services/azureSqlService';

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2025'
  );
}

interface CreateWorkspaceBody {
  navn:            string;
  beskrivelse?:    string;
  kontekstType?:   string;
  kontekstKolonne?: string;
  kontekstVerdi?:  string;
  kontekstLabel?:  string;
}

interface UpdateWorkspaceBody {
  navn?:            string;
  beskrivelse?:     string;
  kontekstType?:    string | null;
  kontekstKolonne?: string | null;
  kontekstVerdi?:   string | null;
  kontekstLabel?:   string | null;
}

// Slår opp erDesignerRapport for en liste av rapport-IDer.
async function hentDesignerFlagg(ids: string[]): Promise<Map<string, boolean>> {
  if (ids.length === 0) return new Map();
  const safeIds = ids.map((id) => `'${id.replace(/[^a-zA-Z0-9\-]/g, '')}'`).join(',');
  try {
    const rows = await queryAzureSQL(
      `SELECT id, erDesignerRapport FROM Rapport WHERE id IN (${safeIds})`,
    );
    return new Map(
      rows.map((r) => [
        (r as { id: string }).id.toLowerCase(),
        Boolean((r as { erDesignerRapport: unknown }).erDesignerRapport),
      ]),
    );
  } catch {
    return new Map();
  }
}

// Slår opp erPersonlig via raw SQL og fletter inn i workspace-listen.
async function slåSammenErPersonlig<T extends { id: string }>(
  workspaces: T[],
): Promise<(T & { erPersonlig: boolean })[]> {
  if (workspaces.length === 0) return workspaces.map((w) => ({ ...w, erPersonlig: false }));
  const ids = workspaces.map((w) => `'${w.id.replace(/[^a-zA-Z0-9\-]/g, '')}'`).join(',');
  try {
    const rows = await queryAzureSQL(`SELECT id, erPersonlig FROM Workspace WHERE id IN (${ids})`);
    const flagMap = new Map(
      rows.map((r) => [(r as { id: string }).id, Boolean((r as { erPersonlig: unknown }).erPersonlig)]),
    );
    return workspaces.map((w) => ({ ...w, erPersonlig: flagMap.get(w.id) ?? false }));
  } catch {
    return workspaces.map((w) => ({ ...w, erPersonlig: false }));
  }
}

export async function workspaceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', resolveTenant);

  // GET /api/workspaces
  fastify.get<{ Querystring: { grupper?: string } }>(
    '/api/workspaces',
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      try {
        const grupper      = request.query.grupper;
        const grupperArray = grupper ? grupper.split(',').filter(Boolean) : [];

        const bruker   = await resolveBruker(request);
        const isAdmin  = erAdmin(bruker?.rolle);
        const entraId  = bruker?.entraObjectId;

        if (isAdmin) {
          const workspaces = await db.workspace.findMany({
            select: {
              id: true,
              navn: true,
              beskrivelse: true,
              opprettetAv: true,
              opprettetDato: true,
              oppdatert: true,
              kontekstType: true,
              kontekstKolonne: true,
              kontekstVerdi: true,
              kontekstLabel: true,
              _count: { select: { rapporter: { where: { rapport: { erAktiv: true } } }, tilgang: true } },
              rapporter: {
                where: { rapport: { erAktiv: true } },
                select: {
                  rapport: { select: { id: true, navn: true } },
                  rekkefølge: true,
                },
                orderBy: { rekkefølge: 'asc' },
              },
            },
            orderBy: { opprettetDato: 'desc' },
          });
          const merged = await slåSammenErPersonlig(workspaces);
          // Personlige mapper er alltid private — admin ser kun sitt eget
          const filtered = merged.filter(w => !w.erPersonlig || w.opprettetAv === (bruker?.id ?? ''));
          return reply.send(filtered);
        }

        const identities = [
          ...(entraId ? [entraId] : []),
          ...grupperArray,
        ];

        if (identities.length === 0) {
          return reply.send([]);
        }

        const workspaceSelect = {
          id: true,
          navn: true,
          beskrivelse: true,
          opprettetAv: true,
          opprettetDato: true,
          oppdatert: true,
          kontekstType: true,
          kontekstKolonne: true,
          kontekstVerdi: true,
          kontekstLabel: true,
          _count: { select: { rapporter: { where: { rapport: { erAktiv: true } } }, tilgang: true } },
          rapporter: {
            where: { rapport: { erAktiv: true } },
            select: {
              rapport: {
                select: {
                  id: true,
                  navn: true,
                  tilgang: { select: { entraId: true } },
                },
              },
              rekkefølge: true,
            },
            orderBy: { rekkefølge: 'asc' as const },
          },
        } as const;

        const direkteWorkspacesRaw = await db.workspace.findMany({
          where: { tilgang: { some: { entraId: { in: identities } } } },
          select: workspaceSelect,
          orderBy: { opprettetDato: 'desc' },
        });

        const direkteIds = new Set(direkteWorkspacesRaw.map((w) => w.id));

        const rapportWorkspacesRaw = await db.workspace.findMany({
          where: {
            id: { notIn: [...direkteIds] },
            rapporter: {
              some: {
                rapport: {
                  erAktiv: true,
                  tilgang: { some: { entraId: { in: identities } } },
                },
              },
            },
          },
          select: workspaceSelect,
          orderBy: { opprettetDato: 'desc' },
        });

        const direkteWorkspaces = direkteWorkspacesRaw.map((ws) => ({
          ...ws,
          rapporter: ws.rapporter.filter((wr) => {
            const t = wr.rapport.tilgang ?? [];
            if (t.length === 0) return true;
            return t.some((r) => identities.includes(r.entraId));
          }),
        }));

        const rapportWorkspaces = rapportWorkspacesRaw.map((ws) => ({
          ...ws,
          rapporter: ws.rapporter.filter((wr) =>
            (wr.rapport.tilgang ?? []).some((r) => identities.includes(r.entraId)),
          ),
        }));

        const allWorkspaces = [...direkteWorkspaces, ...rapportWorkspaces];
        const merged = await slåSammenErPersonlig(allWorkspaces);
        merged.sort((a, b) => (b.erPersonlig ? 1 : 0) - (a.erPersonlig ? 1 : 0));
        return reply.send(merged);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[workspaces] GET /api/workspaces:', error);
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke hente workspaces.', detail });
      }
    },
  );

  // POST /api/workspaces
  fastify.post<{ Body: CreateWorkspaceBody }>(
    '/api/workspaces',
    {
      schema: {
        body: {
          type: 'object',
          required: ['navn'],
          properties: {
            navn:            { type: 'string', minLength: 1 },
            beskrivelse:     { type: 'string' },
            kontekstType:    { type: 'string' },
            kontekstKolonne: { type: 'string' },
            kontekstVerdi:   { type: 'string' },
            kontekstLabel:   { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      try {
        const workspace = await db.workspace.create({
          data: { ...request.body, opprettetAv: 'api' },
        });
        return reply.status(201).send(workspace);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke opprette workspace.' });
      }
    }
  );

  // GET /api/workspaces/:id
  fastify.get<{ Params: { id: string }; Querystring: { grupper?: string } }>(
    '/api/workspaces/:id',
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      try {
        const bruker = await resolveBruker(request);
        const isAdmin = erAdmin(bruker?.rolle);
        const entraId = bruker?.entraObjectId;
        const grupperArray = request.query.grupper ? request.query.grupper.split(',').filter(Boolean) : [];
        const identities = [...(entraId ? [entraId] : []), ...grupperArray];

        const workspace = await db.workspace.findUnique({
          where: { id: request.params.id },
          include: {
            rapporter: {
              where: { rapport: { erAktiv: true } },
              include: { rapport: { include: { tilgang: { select: { entraId: true } } } } },
              orderBy: { rekkefølge: 'asc' },
            },
            tilgang: true,
          },
        });
        if (!workspace) return reply.status(404).send({ error: 'Workspace ikke funnet.' });

        if (isAdmin || identities.length === 0) {
          // Personlige mapper er alltid private — sjekk via raw SQL
          const safeWsId = request.params.id.replace(/[^a-zA-Z0-9\-]/g, '');
          try {
            const rows = await queryAzureSQL(
              `SELECT erPersonlig, opprettetAv FROM Workspace WHERE id = '${safeWsId}'`,
            );
            const erPersonlig = Boolean((rows[0] as { erPersonlig?: unknown })?.erPersonlig);
            const opprettetAv = (rows[0] as { opprettetAv?: string })?.opprettetAv;
            if (erPersonlig && opprettetAv !== bruker?.id) {
              return reply.status(404).send({ error: 'Workspace ikke funnet.' });
            }
          } catch { /* ikke kritisk — fortsett */ }

          const ids = workspace.rapporter.map((wr) => wr.rapport.id);
          const designerMap = await hentDesignerFlagg(ids);
          return reply.send({
            ...workspace,
            rapporter: workspace.rapporter.map((wr) => ({
              ...wr,
              rapport: { ...wr.rapport, erDesignerRapport: designerMap.get(wr.rapport.id.toLowerCase()) ?? false },
            })),
          });
        }

        const safeWsId = request.params.id.replace(/[^a-zA-Z0-9\-]/g, '');
        const inClause  = identities.map((i) => `'${i.replace(/[^a-zA-Z0-9\-]/g, '')}'`).join(',');
        let harTilgang  = false;
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
        } catch {
          harTilgang = workspace.tilgang.some((t) => identities.includes(t.entraId))
            || (bruker !== null && workspace.opprettetAv === bruker.id);
        }

        console.log(
          `[workspaces/:id] id=${safeWsId} | identities=${identities.length}` +
          ` | totalRapporter=${workspace.rapporter.length} | harTilgang=${harTilgang}` +
          ` | tilgangEntraIds=[${workspace.tilgang.map((t) => t.entraId).join(',')}]` +
          ` | opprettetAv=${workspace.opprettetAv} | brukerId=${bruker?.id ?? 'null'}`,
        );

        const filtrerteRapporter = workspace.rapporter.filter((wr) => {
          const t = wr.rapport.tilgang ?? [];
          if (harTilgang) {
            if (t.length === 0) return true;
            return t.some((r) => identities.includes(r.entraId));
          }
          return t.some((r) => identities.includes(r.entraId));
        });

        const ids = filtrerteRapporter.map((wr) => wr.rapport.id);
        const designerMap = await hentDesignerFlagg(ids);
        console.log(`[workspaces/:id] filtrerteRapporter=${filtrerteRapporter.length} | designerFlagg=${[...designerMap.entries()].map(([k,v]) => `${k}=${v}`).join(',')}`);

        return reply.send({
          ...workspace,
          rapporter: filtrerteRapporter.map((wr) => ({
            ...wr,
            rapport: {
              ...wr.rapport,
              tilgang: undefined,
              erDesignerRapport: designerMap.get(wr.rapport.id.toLowerCase()) ?? false,
            },
          })),
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke hente workspace.' });
      }
    }
  );

  // PUT /api/workspaces/:id
  fastify.put<{ Params: { id: string }; Body: UpdateWorkspaceBody }>(
    '/api/workspaces/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            navn:            { type: 'string', minLength: 1 },
            beskrivelse:     { type: ['string', 'null'] },
            kontekstType:    { type: ['string', 'null'] },
            kontekstKolonne: { type: ['string', 'null'] },
            kontekstVerdi:   { type: ['string', 'null'] },
            kontekstLabel:   { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      try {
        const workspace = await db.workspace.update({
          where: { id: request.params.id },
          data: request.body,
        });
        return reply.send(workspace);
      } catch (error) {
        if (isNotFound(error)) return reply.status(404).send({ error: 'Workspace ikke funnet.' });
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke oppdatere workspace.' });
      }
    }
  );

  // DELETE /api/workspaces/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/workspaces/:id',
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      try {
        await db.workspace.delete({ where: { id: request.params.id } });
        return reply.status(204).send();
      } catch (error) {
        if (isNotFound(error)) return reply.status(404).send({ error: 'Workspace ikke funnet.' });
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke slette workspace.' });
      }
    }
  );

  // GET /api/workspaces/:id/views
  // Returnerer unike views fra alle rapporter i workspacet (PBI + designer)
  fastify.get<{ Params: { id: string } }>(
    '/api/workspaces/:id/views',
    async (request, reply) => {
      const safeWsId = request.params.id.replace(/[^a-zA-Z0-9\-]/g, '');
      try {
        const rows = await queryAzureSQL(`
          -- Views fra PBI-rapporter via metadata-kobling
          SELECT DISTINCT
            v.schema_name + '.' + v.view_name AS viewNavn,
            v.visningsnavn                    AS visningsnavn
          FROM ai_metadata_views v
          JOIN ai_rapport_view_kobling k ON k.view_id = v.id
          JOIN WorkspaceRapport wr ON wr.rapportId = k.rapport_id
          WHERE wr.workspaceId = '${safeWsId}' AND v.er_aktiv = 1

          UNION

          -- Views fra designer-rapporter via designerConfig JSON
          SELECT DISTINCT
            JSON_VALUE(r.designerConfig, '$.viewNavn')                                          AS viewNavn,
            COALESCE(JSON_VALUE(r.designerConfig, '$.visningsnavn'),
                     JSON_VALUE(r.designerConfig, '$.viewNavn'))                                AS visningsnavn
          FROM Rapport r
          JOIN WorkspaceRapport wr ON wr.rapportId = r.id
          WHERE wr.workspaceId = '${safeWsId}'
            AND r.erAktiv = 1
            AND r.erDesignerRapport = 1
            AND JSON_VALUE(r.designerConfig, '$.viewNavn') IS NOT NULL
        `);

        // Dedup og bygg svarliste
        const viewMap = new Map<string, string>();
        for (const row of rows) {
          const r = row as { viewNavn?: string; visningsnavn?: string };
          if (r.viewNavn && !viewMap.has(r.viewNavn)) {
            viewMap.set(r.viewNavn, r.visningsnavn ?? r.viewNavn);
          }
        }

        const views = Array.from(viewMap.entries()).map(([viewNavn, visningsnavn]) => ({
          viewNavn,
          visningsnavn,
        }));

        return reply.send(views);
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Kunne ikke hente views.' });
      }
    },
  );
}
