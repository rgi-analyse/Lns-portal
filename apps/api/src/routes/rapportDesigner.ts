import type { FastifyInstance } from 'fastify';
import { requireBruker, type AuthRequest } from '../middleware/auth';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';
import type { PrismaClient } from '../generated/prisma/client';
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
  db: PrismaClient,
): Promise<string> {
  const rows = await queryAzureSQL(
    `SELECT mittWorkspaceId FROM bruker WHERE id = '${safeId(brukerId)}'`,
  );
  const existing = (rows[0] as { mittWorkspaceId?: string } | undefined)?.mittWorkspaceId;
  if (existing) return existing;

  const workspace = await db.workspace.create({
    data: {
      navn: `Mine rapporter – ${displayName}`,
      beskrivelse: `Personlig arbeidsområde for ${displayName}`,
      opprettetAv: brukerId,
    },
  });

  await executeAzureSQL(
    `UPDATE Workspace SET erPersonlig = 1 WHERE id = '${safeId(workspace.id)}'`,
  );

  await db.tilgang.create({
    data: {
      workspaceId: workspace.id,
      type: 'bruker',
      entraId: entraObjectId,
      visningsnavn: displayName,
      rolle: 'eier',
    },
  });

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
    { preHandler: [resolveTenant, requireBruker] },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const bruker = (request as AuthRequest).bruker;
      const { tittel, beskrivelse, fraRapportId, config } = request.body;

      if (!tittel?.trim()) {
        return reply.status(400).send({ error: 'Tittel er påkrevd.' });
      }

      if (fraRapportId) {
        const safeFraId = safeId(fraRapportId);
        try {
          const wsRows = await queryAzureSQL(`
            SELECT TOP 1
              w.navn             AS workspace_navn,
              w.kontekstKolonne  AS kontekstKolonne,
              w.kontekstVerdi    AS kontekstVerdi,
              w.kontekstType     AS kontekstType
            FROM WorkspaceRapport wr
            JOIN Workspace w ON w.id = wr.workspaceId
            WHERE wr.rapportId = '${safeFraId}'
          `);
          const ws = wsRows[0] as {
            workspace_navn?: string;
            kontekstKolonne?: string;
            kontekstVerdi?: string;
            kontekstType?: string;
          } | undefined;

          // Bruk eksplisitt kontekst-kolonne/-verdi fra workspace hvis satt
          const kontekstKolonne = ws?.kontekstKolonne ?? null;
          const kontekstVerdi   = ws?.kontekstVerdi   ?? null;
          const kontekstType    = ws?.kontekstType     ?? null;

          if (kontekstKolonne && kontekstVerdi) {
            config.prosjektNr       = kontekstVerdi;
            config.prosjektKolonne  = kontekstKolonne;
            config.prosjektKolonneType = kontekstType === 'string' ? 'string' : 'number';
            const isNum = config.prosjektKolonneType !== 'string';
            config.prosjektFilter   = `WHERE [${kontekstKolonne}] = ${isNum ? kontekstVerdi : `'${kontekstVerdi}'`}`;
            config.laastFilter      = { kolonne: kontekstKolonne, verdi: kontekstVerdi };
            console.log('[Designer] kontekst fra workspace:', { kontekstKolonne, kontekstVerdi, kontekstType });
          } else {
            // Fallback: trekk ut tall fra workspace-navn (bakoverkompatibilitet)
            // Kun sett prosjektNr hvis prosjektKolonne allerede er satt i config —
            // ellers ville globale views få prosjektNr uten kolonne, noe som
            // ødelegger WHERE-klausulen og gir full table scan ved hentData.
            const wsNavn = ws?.workspace_navn ?? '';
            const match = wsNavn.match(/\b(\d{4,5})\b/);
            if (match && config.prosjektKolonne) {
              const prosjektNrFromDb = match[1];
              config.prosjektNr = prosjektNrFromDb;
              const isNum = config.prosjektKolonneType !== 'string';
              config.prosjektFilter = `WHERE [${config.prosjektKolonne}] = ${isNum ? prosjektNrFromDb : `'${prosjektNrFromDb}'`}`;
              config.laastFilter = { kolonne: config.prosjektKolonne, verdi: prosjektNrFromDb };
              console.log('[Designer] prosjektNr fra workspace-navn (fallback):', prosjektNrFromDb);
            }
          }
        } catch (err) {
          console.error('[Designer] kunne ikke hente kontekst fra fraRapportId:', err);
        }
      }

      const displayName = bruker.displayName ?? bruker.email ?? 'Ukjent';

      const wsId = await hentEllerOpprettMittWorkspace(
        bruker.id,
        bruker.entraObjectId,
        displayName,
        db,
      );

      const rapport = await db.rapport.create({
        data: {
          navn: tittel.trim(),
          beskrivelse: beskrivelse ?? '',
          pbiReportId: '',
          pbiDatasetId: '',
          pbiWorkspaceId: '',
        },
      });

      const configJson = JSON.stringify(config).replace(/'/g, "''");
      await executeAzureSQL(
        `UPDATE Rapport SET erDesignerRapport = 1, designerConfig = '${configJson}' WHERE id = '${safeId(rapport.id)}'`,
      );

      await db.workspaceRapport.create({
        data: { workspaceId: wsId, rapportId: rapport.id, rekkefølge: 0 },
      });

      console.log('[Designer] rapport lagret:', tittel, '→ workspace:', wsId);
      return reply.send({ success: true, rapportId: rapport.id, workspaceId: wsId });
    },
  );

  // PUT /api/rapport-designer/:id
  fastify.put<{ Params: { id: string }; Body: LagreBody }>(
    '/api/rapport-designer/:id',
    { preHandler: [resolveTenant, requireBruker] },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const bruker = (request as AuthRequest).bruker;
      const id = safeId(request.params.id);
      const { tittel, beskrivelse, config } = request.body;

      if (!tittel?.trim()) {
        return reply.status(400).send({ error: 'Tittel er påkrevd.' });
      }

      const flagRows = await queryAzureSQL(
        `SELECT erDesignerRapport FROM Rapport WHERE id = '${id}' AND erAktiv = 1`,
      );
      if (!(flagRows[0] as { erDesignerRapport?: unknown } | undefined)?.erDesignerRapport) {
        return reply.status(403).send({ error: 'Kun designer-rapporter kan oppdateres.' });
      }

      const access = await db.workspaceRapport.findFirst({
        where: {
          rapportId: id,
          workspace: { tilgang: { some: { entraId: bruker.entraObjectId } } },
        },
        select: { rapportId: true },
      });
      if (!access) {
        return reply.status(403).send({ error: 'Ikke tilgang til denne rapporten.' });
      }

      await db.rapport.update({
        where: { id },
        data: { navn: tittel.trim(), beskrivelse: beskrivelse ?? '' },
      });

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
    { preHandler: [resolveTenant, requireBruker] },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const bruker = (request as AuthRequest).bruker;
      const id = request.params.id;
      const { navn } = request.body;

      if (!navn?.trim()) {
        return reply.status(400).send({ error: 'Navn kan ikke være tomt.' });
      }

      const access = await db.workspaceRapport.findFirst({
        where: {
          rapportId: id,
          workspace: { tilgang: { some: { entraId: bruker.entraObjectId } } },
        },
        select: { rapportId: true },
      });
      if (!access) {
        return reply.status(403).send({ error: 'Ikke tilgang til denne rapporten.' });
      }

      await db.rapport.update({ where: { id }, data: { navn: navn.trim() } });
      console.log('[Designer] rapport omdøpt:', id, '→', navn.trim());
      return reply.send({ success: true, navn: navn.trim() });
    },
  );

  // DELETE /api/rapport-designer/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/rapport-designer/:id',
    { preHandler: [resolveTenant, requireBruker] },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const bruker = (request as AuthRequest).bruker;
      const id = safeId(request.params.id);

      const flagRows = await queryAzureSQL(
        `SELECT erDesignerRapport FROM Rapport WHERE id = '${id}' AND erAktiv = 1`,
      );
      if (!(flagRows[0] as { erDesignerRapport?: unknown } | undefined)?.erDesignerRapport) {
        return reply.status(403).send({ error: 'Kun designer-rapporter kan slettes.' });
      }

      const access = await db.workspaceRapport.findFirst({
        where: {
          rapportId: id,
          workspace: { tilgang: { some: { entraId: bruker.entraObjectId } } },
        },
        select: { rapportId: true },
      });
      if (!access) {
        return reply.status(403).send({ error: 'Ikke tilgang til denne rapporten.' });
      }

      await db.rapport.update({ where: { id }, data: { erAktiv: false } });
      console.log('[Designer] rapport slettet (soft):', id);
      return reply.status(204).send();
    },
  );

  // GET /api/rapport-designer/view-kolonner
  fastify.get<{ Querystring: { viewNavn: string } }>(
    '/api/rapport-designer/view-kolonner',
    async (request, reply) => {
      const { viewNavn } = request.query;

      if (!viewNavn?.startsWith('ai_gold.')) {
        return reply.status(400).send({ error: 'Kun ai_gold views tillatt.' });
      }

      // Bruk indexOf for å håndtere view-navn som inneholder punktum
      const dotIdx = viewNavn.indexOf('.');
      const schema = (dotIdx !== -1 ? viewNavn.slice(0, dotIdx) : 'dbo').replace(/[^a-zA-Z0-9_]/g, '');
      // Behold norske bokstaver (æøå) — kun fjern tegn som er farlige i SQL-kontekst.
      // Alle metadata-spørringer bruker @view-parameter, så ingen injeksjonsrisiko.
      const view   = (dotIdx !== -1 ? viewNavn.slice(dotIdx + 1) : viewNavn).replace(/['";\x00-\x1f]/g, '');
      console.log('[view-kolonner] schema:', schema, '| view:', view, '| original:', viewNavn);
      if (!schema || !view) return reply.status(400).send({ error: 'Ugyldig viewNavn.' });

      try {
        const viewDiag = await queryAzureSQL(
          `SELECT id, schema_name, view_name, er_aktiv
           FROM ai_metadata_views
           WHERE view_name = @view`,
          { view },
        );
        console.log('[view-kolonner] ai_metadata_views treff for view:', viewDiag.length, viewDiag);

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

        console.warn('[view-kolonner] ingen metadata funnet — fallback til INFORMATION_SCHEMA');

        // Diagnose: vis hvilke view-navn som faktisk finnes med lignende navn
        const diagnose = await queryAzureSQL(
          `SELECT DISTINCT TOP 10 TABLE_SCHEMA, TABLE_NAME
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = @schema
             AND TABLE_NAME LIKE @likePat`,
          { schema, likePat: `${view.substring(0, Math.min(10, view.length))}%` },
        );
        console.log('[view-kolonner] INFORMATION_SCHEMA diagnose (like-søk):', JSON.stringify(diagnose));

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

        if (rows.length > 0) {
          return reply.send({ kolonner: rows, kilde: 'information_schema' });
        }

        // Fallback: hent kolonner direkte fra viewet via SELECT TOP 1
        // Nyttig når TABLE_NAME i INFORMATION_SCHEMA har annen encoding enn view-navnet vi fikk
        console.warn('[view-kolonner] INFORMATION_SCHEMA ga 0 treff — prøver direkte SELECT TOP 1');
        try {
          const safeSchema = schema.replace(/[^a-zA-Z0-9_]/g, '');
          const safeView   = view.replace(/\]/g, '');  // bare fjern ] for bracket-escaping
          const sample = await queryAzureSQL(
            `SELECT TOP 1 * FROM [${safeSchema}].[${safeView}]`,
          );
          if (sample.length > 0) {
            const kolonner = Object.keys(sample[0]).map(k => ({
              kolonne_navn: k,
              kolonne_type: 'dimensjon' as string,
              datatype:     'varchar',
              sort_order:   0,
            }));
            console.log('[view-kolonner] fallback direkte SELECT kolonner:', kolonner.length);
            return reply.send({ kolonner, kilde: 'direkte_select' });
          }
          console.warn('[view-kolonner] direkte SELECT ga 0 rader — view er tomt eller ikke tilgjengelig');
          return reply.send({ kolonner: [], kilde: 'direkte_select' });
        } catch (fallbackErr) {
          console.error('[view-kolonner] direkte SELECT feilet:', fallbackErr);
          return reply.send({ kolonner: [], kilde: 'information_schema' });
        }
      } catch (err) {
        console.error('[view-kolonner] feil:', err);
        return reply.status(500).send({ error: 'Kunne ikke hente kolonner.' });
      }
    },
  );

  // GET /api/rapport-designer/kolonneverdier
  fastify.get<{ Querystring: { viewNavn: string; kolonne: string; prosjektFilter?: string; kaskadefiltere?: string } }>(
    '/api/rapport-designer/kolonneverdier',
    async (request, reply) => {
      const { viewNavn, kolonne, prosjektFilter, kaskadefiltere } = request.query;

      console.log('[kolonneverdier] viewNavn:', viewNavn, '| kolonne:', kolonne);

      if (!viewNavn?.startsWith('ai_gold.')) {
        console.error('[kolonneverdier] ugyldig viewNavn:', viewNavn);
        return reply.status(400).send({ error: 'Kun ai_gold views tillatt.' });
      }

      const safeKolonne = kolonne.replace(/[\[\]']/g, '');
      if (!safeKolonne) return reply.status(400).send({ error: 'Ugyldig kolonnenavn.' });

      const whereParts: string[] = [
        `[${safeKolonne}] IS NOT NULL`,
        `CAST([${safeKolonne}] AS NVARCHAR(MAX)) <> ''`,
      ];

      if (prosjektFilter) {
        whereParts.push(prosjektFilter.replace(/^WHERE\s+/i, '').trim());
      }

      // Kaskadefiltrering: begrens verdier til gyldige gitt aktive filtre fra klient
      if (kaskadefiltere) {
        try {
          const filtre = JSON.parse(kaskadefiltere) as { kolonne: string; operator: string; verdi: string }[];
          for (const f of filtre) {
            if (!f.kolonne || !f.verdi) continue;
            const kol = `[${f.kolonne.replace(/[\[\]']/g, '')}]`;
            const erNumerisk = f.verdi.trim() !== '' && !isNaN(Number(f.verdi));
            const val = (f.operator === 'LIKE' || f.operator === 'NOT LIKE')
              ? `'%${f.verdi.replace(/'/g, "''")}%'`
              : erNumerisk
                ? f.verdi
                : `'${f.verdi.replace(/'/g, "''")}'`;
            whereParts.push(`${kol} ${f.operator} ${val}`);
          }
        } catch {
          fastify.log.warn('[kolonneverdier] ugyldig kaskadefiltere JSON — ignorerer');
        }
      }

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
