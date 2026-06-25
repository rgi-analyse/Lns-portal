import type { FastifyInstance } from 'fastify';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';
import { resolveBruker, erAdmin } from '../middleware/auth';
import { queryAzureSQL, queryAzureSQLForTenant } from '../services/azureSqlService';
import { verifiserGrupper } from '../services/graphService';

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

// Case-insensitiv id-sammenligning. SQL Server kan returnere uniqueidentifier
// i UPPERCASE via rå mssql mens Prisma gir lowercase — direkte === bommer da.
// Tom/undefined på en av sidene gir alltid false.
function sammeId(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

// Slår opp erDesignerRapport for en liste av rapport-IDer.
// databaseUrl: tenant-DB (Rapport-data ligger i tenant-DB, ikke master).
async function hentDesignerFlagg(databaseUrl: string, ids: string[]): Promise<Map<string, boolean>> {
  if (ids.length === 0) return new Map();
  const safeIds = ids.map((id) => `'${id.replace(/[^a-zA-Z0-9\-]/g, '')}'`).join(',');
  try {
    const rows = await queryAzureSQLForTenant(
      databaseUrl,
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
// erPersonlig: false = bekreftet ikke-personlig, true = personlig,
// null = UKJENT (oppslag feilet / id ikke funnet). Kallere må behandle null
// konservativt (som personlig/privat), så et transient SQL-feil ikke lekker
// andres personlige workspaces til admin.
async function slåSammenErPersonlig<T extends { id: string }>(
  databaseUrl: string,
  workspaces: T[],
): Promise<(T & { erPersonlig: boolean | null })[]> {
  if (workspaces.length === 0) return [];
  const ids = workspaces.map((w) => `'${w.id.replace(/[^a-zA-Z0-9\-]/g, '')}'`).join(',');
  try {
    const rows = await queryAzureSQLForTenant(databaseUrl, `SELECT id, erPersonlig FROM Workspace WHERE id IN (${ids})`);
    // NB: SQL Server returnerer uniqueidentifier i UPPERCASE via rå mssql, mens
    // Prisma gir lowercase. Normaliser begge sider (samme som hentDesignerFlagg)
    // — ellers bommer oppslaget og alt blir null -> admin ser tom liste.
    const flagMap = new Map(
      rows.map((r) => [(r as { id: string }).id.toLowerCase(), Boolean((r as { erPersonlig: unknown }).erPersonlig)]),
    );
    return workspaces.map((w) => ({ ...w, erPersonlig: flagMap.get(w.id.toLowerCase()) ?? null }));
  } catch {
    return workspaces.map((w) => ({ ...w, erPersonlig: null }));
  }
}

export async function workspaceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', resolveTenant);

  // GET /api/workspaces
  fastify.get<{ Querystring: { grupper?: string } }>(
    '/api/workspaces',
    async (request, reply) => {
      const db    = (request as TenantRequest).tenantPrisma;
      const dbUrl = (request as TenantRequest).tenantDatabaseUrl;
      if (!dbUrl) return reply.status(500).send({ error: 'Mangler tenant-kontekst.' });
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
              sortOrder: true,
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
            orderBy: [{ sortOrder: 'asc' }, { navn: 'asc' }],
          });
          const merged = await slåSammenErPersonlig(dbUrl, workspaces);
          // Personlige (og ukjente, konservativt) mapper er private — admin ser kun sine egne.
          // Kun bekreftet ikke-personlig (=== false) vises til andre enn eier.
          const filtered = merged.filter(w => w.erPersonlig === false || w.opprettetAv === (bruker?.id ?? ''));
          return reply.send(filtered);
        }

        // Verifiser klient-styrte grupper mot faktisk Entra-medlemskap.
        const verifiserteGrupper = entraId
          ? await verifiserGrupper(entraId, grupperArray, !!bruker?.erEntraBruker)
          : [];
        const identities = [
          ...(entraId ? [entraId] : []),
          ...verifiserteGrupper,
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
          sortOrder: true,
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

        const ordreByAdmin = [{ sortOrder: 'asc' as const }, { navn: 'asc' as const }];

        const direkteWorkspacesRaw = await db.workspace.findMany({
          where: { tilgang: { some: { entraId: { in: identities } } } },
          select: workspaceSelect,
          orderBy: ordreByAdmin,
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
          orderBy: ordreByAdmin,
        });

        // Strip rapport.tilgang fra responsen (eksponerte hvem som har tilgang).
        // Filtreres fortsatt på tilgang før feltet fjernes.
        const stripTilgang = <W extends { rapporter: Array<{ rapport: { tilgang?: unknown } }> }>(ws: W) => ({
          ...ws,
          rapporter: ws.rapporter.map(({ rapport: { tilgang: _t, ...rapport }, ...wr }) => ({ ...wr, rapport })),
        });

        const direkteWorkspaces = direkteWorkspacesRaw.map((ws) => stripTilgang({
          ...ws,
          rapporter: ws.rapporter.filter((wr) => {
            const t = wr.rapport.tilgang ?? [];
            if (t.length === 0) return true;
            return t.some((r) => identities.includes(r.entraId));
          }),
        }));

        const rapportWorkspaces = rapportWorkspacesRaw.map((ws) => stripTilgang({
          ...ws,
          rapporter: ws.rapporter.filter((wr) =>
            (wr.rapport.tilgang ?? []).some((r) => identities.includes(r.entraId)),
          ),
        }));

        const allWorkspaces = [...direkteWorkspaces, ...rapportWorkspaces];
        const merged = await slåSammenErPersonlig(dbUrl, allWorkspaces);
        merged.sort((a, b) => {
          const personligDiff = (b.erPersonlig ? 1 : 0) - (a.erPersonlig ? 1 : 0);
          if (personligDiff !== 0) return personligDiff;
          const ordreDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
          if (ordreDiff !== 0) return ordreDiff;
          return a.navn.localeCompare(b.navn, 'nb');
        });
        return reply.send(merged);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[workspaces] GET /api/workspaces:', error);
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke hente workspaces.', detail });
      }
    },
  );

  // PATCH /api/workspaces/rekkefolge
  // Tar imot { rekkefolge: [{ id, sortOrder }] } og oppdaterer alle i én transaksjon.
  // Krever admin-rolle.
  fastify.patch<{ Body: { rekkefolge: Array<{ id: string; sortOrder: number }> } }>(
    '/api/workspaces/rekkefolge',
    {
      schema: {
        body: {
          type: 'object',
          required: ['rekkefolge'],
          properties: {
            rekkefolge: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'sortOrder'],
                properties: {
                  id:        { type: 'string', minLength: 1 },
                  sortOrder: { type: 'integer', minimum: 0 },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const bruker = await resolveBruker(request);
      if (!bruker) return reply.status(401).send({ error: 'Ikke innlogget.' });
      if (!erAdmin(bruker.rolle)) return reply.status(403).send({ error: 'Krever admin-tilgang.' });

      const db = (request as TenantRequest).tenantPrisma;
      const { rekkefolge } = request.body;
      if (rekkefolge.length === 0) return reply.send({ oppdatert: 0 });

      try {
        await db.$transaction(
          rekkefolge.map((w) =>
            db.workspace.update({
              where: { id: w.id },
              data: { sortOrder: w.sortOrder },
            }),
          ),
        );
        return reply.send({ oppdatert: rekkefolge.length });
      } catch (error) {
        if (isNotFound(error)) return reply.status(404).send({ error: 'Workspace ikke funnet.' });
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke oppdatere rekkefølgen.' });
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
      const bruker = await resolveBruker(request);
      if (!bruker) return reply.status(401).send({ error: 'Ikke innlogget.' });
      if (!erAdmin(bruker.rolle)) return reply.status(403).send({ error: 'Krever admin-tilgang.' });

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
      const db    = (request as TenantRequest).tenantPrisma;
      const dbUrl = (request as TenantRequest).tenantDatabaseUrl;
      if (!dbUrl) return reply.status(500).send({ error: 'Mangler tenant-kontekst.' });
      try {
        const bruker = await resolveBruker(request);
        const isAdmin = erAdmin(bruker?.rolle);
        const entraId = bruker?.entraObjectId;
        const grupperArray = request.query.grupper ? request.query.grupper.split(',').filter(Boolean) : [];
        const verifiserteGrupper = entraId
          ? await verifiserGrupper(entraId, grupperArray, !!bruker?.erEntraBruker)
          : [];
        const identities = [...(entraId ? [entraId] : []), ...verifiserteGrupper];

        // H7: ingen identitet (anonym/manglende header) skal aldri gi full tilgang.
        // Sjekkes FØR eksistens-oppslaget — gir deterministisk 401 og unngår
        // eksistens-oracle (404 vs 401) samt unødvendig DB-spørring.
        if (!isAdmin && identities.length === 0) {
          return reply.status(401).send({ error: 'Ikke innlogget.' });
        }

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

        if (isAdmin) {
          // Personlige mapper er alltid private — sjekk via raw SQL
          const safeWsId = request.params.id.replace(/[^a-zA-Z0-9\-]/g, '');
          try {
            const rows = await queryAzureSQLForTenant(
              dbUrl,
              `SELECT erPersonlig, opprettetAv FROM Workspace WHERE id = '${safeWsId}'`,
            );
            const erPersonlig = Boolean((rows[0] as { erPersonlig?: unknown })?.erPersonlig);
            const opprettetAv = (rows[0] as { opprettetAv?: string })?.opprettetAv;
            if (erPersonlig && !sammeId(opprettetAv, bruker?.id)) {
              return reply.status(404).send({ error: 'Workspace ikke funnet.' });
            }
          } catch {
            // Konservativt: kan ikke bekrefte at workspacet ikke er personlig -> nekt med mindre eier
            if (!sammeId(workspace.opprettetAv, bruker?.id)) {
              return reply.status(404).send({ error: 'Workspace ikke funnet.' });
            }
          }

          const ids = workspace.rapporter.map((wr) => wr.rapport.id);
          const designerMap = await hentDesignerFlagg(dbUrl, ids);
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
          const tilgangRows = await queryAzureSQLForTenant(dbUrl, `
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
        const designerMap = await hentDesignerFlagg(dbUrl, ids);
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
      const bruker = await resolveBruker(request);
      if (!bruker) return reply.status(401).send({ error: 'Ikke innlogget.' });
      if (!erAdmin(bruker.rolle)) return reply.status(403).send({ error: 'Krever admin-tilgang.' });

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
      const bruker = await resolveBruker(request);
      if (!bruker) return reply.status(401).send({ error: 'Ikke innlogget.' });
      if (!erAdmin(bruker.rolle)) return reply.status(403).send({ error: 'Krever admin-tilgang.' });

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
  fastify.get<{ Params: { id: string }; Querystring: { grupper?: string } }>(
    '/api/workspaces/:id/views',
    async (request, reply) => {
      const safeWsId = request.params.id.replace(/[^a-zA-Z0-9\-]/g, '');
      const dbUrl    = (request as TenantRequest).tenantDatabaseUrl;
      if (!dbUrl) return reply.status(500).send({ error: 'Mangler tenant-kontekst.' });

      // H5: tilgangssjekk — kun admin eller bruker med tilgang til workspacet.
      const bruker       = await resolveBruker(request);
      const isAdmin      = erAdmin(bruker?.rolle);
      const entraId      = bruker?.entraObjectId;
      const grupperArray = request.query.grupper ? request.query.grupper.split(',').filter(Boolean) : [];
      const verifiserteGrupper = entraId
        ? await verifiserGrupper(entraId, grupperArray, !!bruker?.erEntraBruker)
        : [];
      const identities   = [...(entraId ? [entraId] : []), ...verifiserteGrupper];

      if (!isAdmin) {
        if (identities.length === 0) {
          return reply.status(401).send({ error: 'Ikke innlogget.' });
        }
        const inClause = identities.map((i) => `'${i.replace(/[^a-zA-Z0-9\-]/g, '')}'`).join(',');
        let harTilgang = false;
        try {
          const tilgangRows = await queryAzureSQLForTenant(dbUrl, `
            SELECT 1 FROM Tilgang
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
          harTilgang = false;
        }
        if (!harTilgang) {
          return reply.status(403).send({ error: 'Ingen tilgang til workspace.' });
        }
      }

      try {
        // ai_metadata_* er master-globale (sql/001 "kjøres mot lns-dwh"), mens
        // WorkspaceRapport/Rapport er per-tenant. Spørringen er derfor cross-DB og
        // kjøres i to steg: 1) rapport-IDer + designer-views fra tenant-DB,
        // 2) PBI-view-defs fra master, 3) flett i kode.
        const viewMap = new Map<string, string>();

        // Steg 1 (tenant-DB): rapport-IDer i workspacet + designer-rapport-views.
        const tenantRows = await queryAzureSQLForTenant(dbUrl, `
          SELECT wr.rapportId AS rapportId,
                 JSON_VALUE(r.designerConfig, '$.viewNavn')                      AS designerViewNavn,
                 COALESCE(JSON_VALUE(r.designerConfig, '$.visningsnavn'),
                          JSON_VALUE(r.designerConfig, '$.viewNavn'))            AS designerVisningsnavn
          FROM WorkspaceRapport wr
          JOIN Rapport r ON r.id = wr.rapportId
          WHERE wr.workspaceId = '${safeWsId}' AND r.erAktiv = 1
        `);

        for (const row of tenantRows) {
          const r = row as { designerViewNavn?: string | null; designerVisningsnavn?: string | null };
          if (r.designerViewNavn && !viewMap.has(r.designerViewNavn)) {
            viewMap.set(r.designerViewNavn, r.designerVisningsnavn ?? r.designerViewNavn);
          }
        }

        // Steg 2a (tenant): koblede view_id-er for workspacets rapporter
        // (ai_rapport_view_kobling er per-tenant).
        const rapportIds = Array.from(new Set(
          (tenantRows as { rapportId?: string }[])
            .map((r) => r.rapportId)
            .filter((id): id is string => !!id),
        ));
        let viewIds: string[] = [];
        if (rapportIds.length > 0) {
          const rapportInClause = rapportIds.map((id) => `'${id.replace(/[^a-zA-Z0-9\-]/g, '')}'`).join(',');
          const koblinger = await queryAzureSQLForTenant(
            dbUrl,
            `SELECT DISTINCT view_id FROM ai_rapport_view_kobling WHERE rapport_id IN (${rapportInClause})`,
          );
          viewIds = koblinger.map((r) => String((r as { view_id: string }).view_id));
        }

        // Steg 2b (master): PBI-view-defs by view_id (ai_metadata_views er master-global).
        if (viewIds.length > 0) {
          const viewInClause = viewIds.map((id) => `'${id.replace(/[^a-zA-Z0-9\-]/g, '')}'`).join(',');
          const pbiRows = await queryAzureSQL(`
            SELECT DISTINCT
              v.schema_name + '.' + v.view_name AS viewNavn,
              v.visningsnavn                    AS visningsnavn
            FROM ai_metadata_views v
            WHERE v.id IN (${viewInClause}) AND v.er_aktiv = 1
          `);
          for (const row of pbiRows) {
            const r = row as { viewNavn?: string; visningsnavn?: string };
            if (r.viewNavn && !viewMap.has(r.viewNavn)) {
              viewMap.set(r.viewNavn, r.visningsnavn ?? r.viewNavn);
            }
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
