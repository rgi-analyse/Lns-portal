import type { FastifyInstance } from 'fastify';
import { requireBruker, type AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { queryAzureSQL, executeAzureSQL } from '../services/azureSqlService';

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9\-]/g, '');
}

interface DesignerConfig {
  sql?: string;
  viewNavn?: string | null;
  visualType?: string;
  xAkse?: string;
  yAkse?: string;
  grupperPaa?: string | null;
  aggregering?: string;
  prosjektNr?: string | null;
  prosjektNavn?: string | null;
  prosjektKolonne?: string | null;
  prosjektKolonneType?: string | null;
  prosjektFilter?: string | null;
  alleViewKolonner?: { kolonne_navn: string; kolonne_type: string }[];
  maksRader?: number;
  sorterPaa?: string | null;
  sorterRetning?: string;
  ekstraKolonner?: string[];
  laastFilter?: { kolonne: string; verdi: string } | null;
}

interface LagreBody {
  tittel: string;
  beskrivelse?: string;
  fraRapportId?: string;
  config: DesignerConfig;
}

async function hentEllerOpprettMittWorkspace(
  brukerId: string,
  entraObjectId: string,
  displayName: string,
): Promise<string> {
  // Sjekk om bruker allerede har et personlig workspace
  const rows = await queryAzureSQL(
    `SELECT mittWorkspaceId FROM bruker WHERE id = '${safeId(brukerId)}'`,
  );
  const existing = (rows[0] as { mittWorkspaceId?: string } | undefined)?.mittWorkspaceId;
  if (existing) return existing;

  // Opprett nytt workspace via Prisma (erPersonlig settes via raw SQL etterpå)
  const workspace = await prisma.workspace.create({
    data: {
      navn: `Mine rapporter – ${displayName}`,
      beskrivelse: `Personlig arbeidsområde for ${displayName}`,
      opprettetAv: brukerId,
    },
  });

  // Sett erPersonlig-flagget (kolonnen finnes ikke i Prisma-schema)
  await executeAzureSQL(
    `UPDATE Workspace SET erPersonlig = 1 WHERE id = '${safeId(workspace.id)}'`,
  );

  // Gi bruker eier-tilgang til eget workspace
  await prisma.tilgang.create({
    data: {
      workspaceId: workspace.id,
      type: 'bruker',
      entraId: entraObjectId,
      visningsnavn: displayName,
      rolle: 'eier',
    },
  });

  // Lagre workspace-id på brukeren (raw SQL – feltet finnes ikke i Prisma-schema)
  await executeAzureSQL(
    `UPDATE bruker SET mittWorkspaceId = '${safeId(workspace.id)}' WHERE id = '${safeId(brukerId)}'`,
  );

  console.log('[Designer] opprettet personlig workspace:', workspace.navn);
  return workspace.id;
}

export async function rapportDesignerRoutes(fastify: FastifyInstance) {
  // POST /api/rapport-designer/lagre
  fastify.post<{ Body: LagreBody }>(
    '/api/rapport-designer/lagre',
    { preHandler: [requireBruker] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const { tittel, beskrivelse, fraRapportId, config } = request.body;

      if (!tittel?.trim()) {
        return reply.status(400).send({ error: 'Tittel er påkrevd.' });
      }

      // Server-side validering: hent prosjektNr fra databasen — aldri stol på frontend
      if (fraRapportId) {
        const safeFraId = safeId(fraRapportId);
        try {
          const wsRows = await queryAzureSQL(`
            SELECT TOP 1 w.navn AS workspace_navn
            FROM WorkspaceRapport wr
            JOIN Workspace w ON w.id = wr.workspaceId
            WHERE wr.rapportId = '${safeFraId}'
          `);
          const wsNavn = (wsRows[0] as { workspace_navn?: string } | undefined)?.workspace_navn ?? '';
          const match = wsNavn.match(/\b(\d{4,5})\b/);
          if (match) {
            const prosjektNrFromDb = match[1];
            // Override alle prosjekt-felter med DB-hentet verdi
            config.prosjektNr = prosjektNrFromDb;
            if (config.prosjektKolonne) {
              const isNum = config.prosjektKolonneType !== 'string';
              config.prosjektFilter = `WHERE [${config.prosjektKolonne}] = ${isNum ? prosjektNrFromDb : `'${prosjektNrFromDb}'`}`;
              config.laastFilter = { kolonne: config.prosjektKolonne, verdi: prosjektNrFromDb };
            }
            console.log('[Designer] prosjektNr hentet fra DB (fraRapportId):', prosjektNrFromDb);
          }
        } catch (err) {
          console.error('[Designer] kunne ikke hente prosjektNr fra fraRapportId:', err);
        }
      }

      const displayName = bruker.displayName ?? bruker.email ?? 'Ukjent';

      // Hent eller opprett personlig workspace
      const wsId = await hentEllerOpprettMittWorkspace(
        bruker.id,
        bruker.entraObjectId,
        displayName,
      );

      // Opprett designer-rapport via Prisma (nye kolonner settes via raw SQL etterpå)
      const rapport = await prisma.rapport.create({
        data: {
          navn: tittel.trim(),
          beskrivelse: beskrivelse ?? '',
          pbiReportId: '',
          pbiDatasetId: '',
          pbiWorkspaceId: '',
        },
      });

      // Sett designer-kolonner (finnes ikke i Prisma-schema)
      const configJson = JSON.stringify(config).replace(/'/g, "''");
      await executeAzureSQL(
        `UPDATE Rapport SET erDesignerRapport = 1, designerConfig = '${configJson}' WHERE id = '${safeId(rapport.id)}'`,
      );

      // Koble rapport til personlig workspace
      await prisma.workspaceRapport.create({
        data: { workspaceId: wsId, rapportId: rapport.id, rekkefølge: 0 },
      });

      console.log('[Designer] rapport lagret:', tittel, '→ workspace:', wsId);
      return reply.send({ success: true, rapportId: rapport.id, workspaceId: wsId });
    },
  );

  // PUT /api/rapport-designer/:id  (oppdater eksisterende designer-rapport)
  fastify.put<{ Params: { id: string }; Body: LagreBody }>(
    '/api/rapport-designer/:id',
    { preHandler: [requireBruker] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const id = safeId(request.params.id);
      const { tittel, beskrivelse, config } = request.body;

      if (!tittel?.trim()) {
        return reply.status(400).send({ error: 'Tittel er påkrevd.' });
      }

      // Verifiser at dette er en designer-rapport og at bruker har tilgang
      const flagRows = await queryAzureSQL(
        `SELECT erDesignerRapport FROM Rapport WHERE id = '${id}' AND erAktiv = 1`,
      );
      if (!(flagRows[0] as { erDesignerRapport?: unknown } | undefined)?.erDesignerRapport) {
        return reply.status(403).send({ error: 'Kun designer-rapporter kan oppdateres.' });
      }

      const access = await prisma.workspaceRapport.findFirst({
        where: {
          rapportId: id,
          workspace: { tilgang: { some: { entraId: bruker.entraObjectId } } },
        },
        select: { rapportId: true },
      });
      if (!access) {
        return reply.status(403).send({ error: 'Ikke tilgang til denne rapporten.' });
      }

      // Oppdater navn og beskrivelse via Prisma
      await prisma.rapport.update({
        where: { id },
        data: { navn: tittel.trim(), beskrivelse: beskrivelse ?? '' },
      });

      // Oppdater designerConfig via raw SQL
      const configJson = JSON.stringify(config).replace(/'/g, "''");
      await executeAzureSQL(
        `UPDATE Rapport SET designerConfig = '${configJson}' WHERE id = '${id}'`,
      );

      console.log('[Designer] rapport oppdatert:', id, '→', tittel.trim());
      return reply.send({ success: true, rapportId: id });
    },
  );

  // PATCH /api/rapport-designer/:id/navn
  fastify.patch<{ Params: { id: string }; Body: { navn: string } }>(
    '/api/rapport-designer/:id/navn',
    { preHandler: [requireBruker] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const id = request.params.id;
      const { navn } = request.body;

      if (!navn?.trim()) {
        return reply.status(400).send({ error: 'Navn kan ikke være tomt.' });
      }

      // Verifiser tilgang: bruker må ha tilgang til workspacet rapporten tilhører
      const access = await prisma.workspaceRapport.findFirst({
        where: {
          rapportId: id,
          workspace: { tilgang: { some: { entraId: bruker.entraObjectId } } },
        },
        select: { rapportId: true },
      });
      if (!access) {
        return reply.status(403).send({ error: 'Ikke tilgang til denne rapporten.' });
      }

      await prisma.rapport.update({ where: { id }, data: { navn: navn.trim() } });
      console.log('[Designer] rapport omdøpt:', id, '→', navn.trim());
      return reply.send({ success: true, navn: navn.trim() });
    },
  );

  // DELETE /api/rapport-designer/:id  (soft-delete — setter erAktiv = false)
  fastify.delete<{ Params: { id: string } }>(
    '/api/rapport-designer/:id',
    { preHandler: [requireBruker] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const id = safeId(request.params.id);

      // Verifiser at det er en designer-rapport
      const flagRows = await queryAzureSQL(
        `SELECT erDesignerRapport FROM Rapport WHERE id = '${id}' AND erAktiv = 1`,
      );
      if (!(flagRows[0] as { erDesignerRapport?: unknown } | undefined)?.erDesignerRapport) {
        return reply.status(403).send({ error: 'Kun designer-rapporter kan slettes.' });
      }

      // Verifiser eierskap
      const access = await prisma.workspaceRapport.findFirst({
        where: {
          rapportId: id,
          workspace: { tilgang: { some: { entraId: bruker.entraObjectId } } },
        },
        select: { rapportId: true },
      });
      if (!access) {
        return reply.status(403).send({ error: 'Ikke tilgang til denne rapporten.' });
      }

      await prisma.rapport.update({ where: { id }, data: { erAktiv: false } });
      console.log('[Designer] rapport slettet (soft):', id);
      return reply.status(204).send();
    },
  );

  // GET /api/rapport-designer/view-kolonner  (kolonner + typer — metadata-katalog først, INFORMATION_SCHEMA som fallback)
  fastify.get<{ Querystring: { viewNavn: string } }>(
    '/api/rapport-designer/view-kolonner',
    async (request, reply) => {
      const { viewNavn } = request.query;

      if (!viewNavn?.startsWith('ai_gold.')) {
        return reply.status(400).send({ error: 'Kun ai_gold views tillatt.' });
      }

      const parts  = viewNavn.split('.');
      const schema = (parts[0] ?? '').replace(/[^a-zA-Z0-9_]/g, '');
      const view   = (parts[1] ?? '').replace(/[^a-zA-Z0-9_]/g, '');
      console.log('[view-kolonner] schema:', schema, '| view:', view);
      if (!schema || !view) return reply.status(400).send({ error: 'Ugyldig viewNavn.' });

      try {
        // Diagnostikk: vis hva som faktisk finnes i ai_metadata_views for dette viewet
        const viewDiag = await queryAzureSQL(
          `SELECT id, schema_name, view_name, er_aktiv
           FROM ai_metadata_views
           WHERE view_name = @view`,
          { view },
        );
        console.log('[view-kolonner] ai_metadata_views treff for view:', viewDiag.length, viewDiag);

        // Prøv metadata-katalogen — admin-definerte kolonnetyper er autoritære
        const metaRows = await queryAzureSQL(
          `SELECT k.kolonne_navn, k.datatype, k.kolonne_type, k.sort_order
           FROM ai_metadata_kolonner k
           JOIN ai_metadata_views v ON k.view_id = v.id
           WHERE v.schema_name = @schema
             AND v.view_name   = @view
             AND v.er_aktiv    = 1
           ORDER BY k.sort_order, k.kolonne_navn`,
          { schema, view },
        );
        console.log('[view-kolonner] metadata-treff (med er_aktiv=1):', metaRows.length);

        // Prøv uten er_aktiv-filter om første spørring ga 0 — for diagnostikk
        if (metaRows.length === 0 && viewDiag.length > 0) {
          const metaAlle = await queryAzureSQL(
            `SELECT k.kolonne_navn, k.datatype, k.kolonne_type, k.sort_order
             FROM ai_metadata_kolonner k
             JOIN ai_metadata_views v ON k.view_id = v.id
             WHERE v.schema_name = @schema
               AND v.view_name   = @view
             ORDER BY k.sort_order, k.kolonne_navn`,
            { schema, view },
          );
          console.log('[view-kolonner] metadata-treff (uten er_aktiv-filter):', metaAlle.length, metaAlle);
          if (metaAlle.length > 0) {
            console.warn('[view-kolonner] er_aktiv er ikke 1 for dette viewet — bruk likevel metadata');
            return reply.send({ kolonner: metaAlle, kilde: 'metadata' });
          }
        }

        if (metaRows.length > 0) {
          return reply.send({ kolonner: metaRows, kilde: 'metadata' });
        }

        // Fallback: auto-deteksjon fra INFORMATION_SCHEMA
        console.warn('[view-kolonner] ingen metadata funnet — fallback til INFORMATION_SCHEMA');
        const rows = await queryAzureSQL(
          `SELECT
             COLUMN_NAME      AS kolonne_navn,
             DATA_TYPE        AS datatype,
             ORDINAL_POSITION AS sort_order,
             CASE
               WHEN DATA_TYPE IN ('int','bigint','decimal','float','numeric','money','smallmoney',
                                  'smallint','tinyint','real')
                 THEN 'measure'
               WHEN DATA_TYPE IN ('date','datetime','datetime2','smalldatetime',
                                  'datetimeoffset','time')
                 THEN 'dato'
               ELSE 'dimensjon'
             END AS kolonne_type
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = @schema
             AND TABLE_NAME   = @view
           ORDER BY ORDINAL_POSITION`,
          { schema, view },
        );
        console.log('[view-kolonner] INFORMATION_SCHEMA kolonner:', rows.length);
        return reply.send({ kolonner: rows, kilde: 'information_schema' });
      } catch (err) {
        console.error('[view-kolonner] feil:', err);
        return reply.status(500).send({ error: 'Kunne ikke hente kolonner.' });
      }
    },
  );

  // GET /api/rapport-designer/kolonneverdier  (ingen auth-preHandler — read-only, beskyttet av ai_gold.-sjekk)
  fastify.get<{ Querystring: { viewNavn: string; kolonne: string; prosjektFilter?: string } }>(
    '/api/rapport-designer/kolonneverdier',
    async (request, reply) => {
      const { viewNavn, kolonne, prosjektFilter } = request.query;

      console.log('[kolonneverdier] viewNavn:', viewNavn, '| kolonne:', kolonne);

      if (!viewNavn?.startsWith('ai_gold.')) {
        console.error('[kolonneverdier] ugyldig viewNavn:', viewNavn);
        return reply.status(400).send({ error: 'Kun ai_gold views tillatt.' });
      }

      const safeKolonne = kolonne.replace(/[\[\]']/g, '');
      if (!safeKolonne) return reply.status(400).send({ error: 'Ugyldig kolonnenavn.' });

      const projKlausul = prosjektFilter ? prosjektFilter.replace(/^WHERE\s+/i, '').trim() : '';
      const whereParts = [`[${safeKolonne}] IS NOT NULL`, `CAST([${safeKolonne}] AS NVARCHAR(MAX)) <> ''`];
      if (projKlausul) whereParts.push(projKlausul);
      const where = `WHERE ${whereParts.join(' AND ')}`;

      const sql = `SELECT DISTINCT TOP 200 [${safeKolonne}] AS verdi FROM ${viewNavn} ${where} ORDER BY [${safeKolonne}]`;
      console.log('[kolonneverdier] SQL:', sql);

      try {
        const rows = await queryAzureSQL(sql);
        const verdier = rows
          .map(r => (r as { verdi: unknown }).verdi)
          .filter(v => v !== null && v !== undefined && String(v) !== '');
        console.log('[kolonneverdier] returnerer', verdier.length, 'verdier');
        return reply.send({ verdier });
      } catch (err) {
        console.error('[kolonneverdier] SQL feil:', err);
        return reply.status(500).send({ error: 'Kunne ikke hente kolonneverdier.' });
      }
    },
  );

  // GET /api/rapport-designer/:id
  fastify.get<{ Params: { id: string } }>(
    '/api/rapport-designer/:id',
    { preHandler: [requireBruker] },
    async (request, reply) => {
      const id = safeId(request.params.id);

      // Hent designer-felter via raw SQL (finnes ikke i Prisma-schema)
      const rows = await queryAzureSQL(
        `SELECT r.id, r.navn, r.beskrivelse, r.erDesignerRapport, r.designerConfig
         FROM Rapport r WHERE r.id = '${id}' AND r.erAktiv = 1`,
      );
      const row = rows[0] as {
        id: string; navn: string; beskrivelse: string | null;
        erDesignerRapport: boolean; designerConfig: string | null;
      } | undefined;

      if (!row || !row.erDesignerRapport) {
        return reply.status(404).send({ error: 'Designer-rapport ikke funnet.' });
      }

      let config: DesignerConfig = {};
      try {
        if (row.designerConfig) config = JSON.parse(row.designerConfig) as DesignerConfig;
      } catch { /* ignore */ }

      return reply.send({
        id: row.id,
        navn: row.navn,
        beskrivelse: row.beskrivelse,
        config,
      });
    },
  );
}
