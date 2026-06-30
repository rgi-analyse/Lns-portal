import type { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';
import { getAzureToken } from '../lib/azureToken';
import { queryAzureSQL } from '../services/azureSqlService';
import { feilRespons } from '../lib/feilRespons';
import { requireBruker, erAdmin, type AuthRequest } from '../middleware/auth';
import { hentDatatilgang, validerSqlMotTilgang } from '../services/datatilgang';

export async function pbiCreateRoutes(fastify: FastifyInstance) {
  // POST /api/pbi/create-token — henter embed-token for å opprette ny rapport i nettleseren
  fastify.post<{ Body: { pbiDatasetId: string; pbiWorkspaceId: string } }>(
    '/api/pbi/create-token',
    {
      schema: {
        body: {
          type: 'object',
          required: ['pbiDatasetId', 'pbiWorkspaceId'],
          properties: {
            pbiDatasetId:   { type: 'string', minLength: 1 },
            pbiWorkspaceId: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { pbiDatasetId, pbiWorkspaceId } = request.body;

      const tenantId     = process.env.PBI_TENANT_ID;
      const clientId     = process.env.PBI_CLIENT_ID;
      const clientSecret = process.env.PBI_CLIENT_SECRET;

      if (!tenantId || !clientId || !clientSecret) {
        return reply.status(500).send({ error: 'Mangler Power BI-konfigurasjon på serveren.' });
      }

      try {
        const azureToken = await getAzureToken(tenantId, clientId, clientSecret);

        const tokenRes = await fetch('https://api.powerbi.com/v1.0/myorg/GenerateToken', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${azureToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datasets:         [{ id: pbiDatasetId }],
            targetWorkspaces: [{ id: pbiWorkspaceId }],
          }),
        });

        if (!tokenRes.ok) {
          const errBody = await tokenRes.text();
          logger.error('[pbiCreateToken] GenerateToken feil:', tokenRes.status, errBody);
          return reply.status(502).send({ error: `Power BI token-feil (HTTP ${tokenRes.status})`, detail: errBody });
        }

        const tokenData = await tokenRes.json() as { token: string; expiration: string };
        logger.debug('[pbiCreateToken] token hentet, utløper:', tokenData.expiration);
        return reply.send({ token: tokenData.token, expiration: tokenData.expiration });
      } catch (error) {
        return feilRespons(reply, 500, 'Kunne ikke hente Power BI-token.', error);
      }
    },
  );

  // POST /api/pbi/register-rapport — registrer en allerede lagret PBI-rapport i portal-DB
  fastify.post<{ Body: { pbiReportId: string; pbiDatasetId: string; pbiWorkspaceId: string; navn: string; beskrivelse?: string } }>(
    '/api/pbi/register-rapport',
    {
      preHandler: [resolveTenant],
      schema: {
        body: {
          type: 'object',
          required: ['pbiReportId', 'pbiDatasetId', 'pbiWorkspaceId', 'navn'],
          properties: {
            pbiReportId:    { type: 'string', minLength: 1 },
            pbiDatasetId:   { type: 'string', minLength: 1 },
            pbiWorkspaceId: { type: 'string', minLength: 1 },
            navn:           { type: 'string', minLength: 1 },
            beskrivelse:    { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const { pbiReportId, pbiDatasetId, pbiWorkspaceId, navn, beskrivelse } = request.body;
      try {
        const eksisterende = await db.rapport.findFirst({ where: { pbiReportId } });
        if (eksisterende) {
          return reply.send({ id: eksisterende.id, navn: eksisterende.navn });
        }
        const rapport = await db.rapport.create({
          data: { pbiReportId, pbiDatasetId, pbiWorkspaceId, navn, beskrivelse: beskrivelse ?? null },
        });
        logger.debug('[pbiRegister] Ny rapport registrert i DB:', rapport.id, rapport.navn);
        return reply.status(201).send({ id: rapport.id, navn: rapport.navn });
      } catch (error) {
        return feilRespons(reply, 500, 'Kunne ikke registrere rapporten.', error);
      }
    },
  );

  // DELETE /api/pbi/slett-rapport — slett rapport fra PBI + portal DB (brukes ved forkast)
  fastify.delete<{ Body: { rapportId: string; pbiReportId: string; pbiWorkspaceId: string } }>(
    '/api/pbi/slett-rapport',
    {
      preHandler: [resolveTenant],
      schema: {
        body: {
          type: 'object',
          required: ['rapportId', 'pbiReportId', 'pbiWorkspaceId'],
          properties: {
            rapportId:      { type: 'string', minLength: 1 },
            pbiReportId:    { type: 'string', minLength: 1 },
            pbiWorkspaceId: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const { rapportId, pbiReportId, pbiWorkspaceId } = request.body;

      const tenantId     = process.env.PBI_TENANT_ID;
      const clientId     = process.env.PBI_CLIENT_ID;
      const clientSecret = process.env.PBI_CLIENT_SECRET;

      if (!tenantId || !clientId || !clientSecret) {
        return reply.status(500).send({ error: 'Mangler Power BI-konfigurasjon på serveren.' });
      }

      try {
        const azureToken = await getAzureToken(tenantId, clientId, clientSecret);

        // Slett fra Power BI
        const deleteUrl = `https://api.powerbi.com/v1.0/myorg/groups/${pbiWorkspaceId}/reports/${pbiReportId}`;
        const deleteRes = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${azureToken}` },
        });

        if (!deleteRes.ok && deleteRes.status !== 404) {
          const errBody = await deleteRes.text();
          logger.error('[pbiSlett] PBI DELETE feil:', deleteRes.status, errBody);
          // Ikke avbryt — slett uansett fra DB
        } else {
          logger.debug('[pbiSlett] Slettet fra PBI:', pbiReportId);
        }

        // Slett fra portal DB
        await db.rapport.delete({ where: { id: rapportId } });
        logger.debug('[pbiSlett] Slettet fra DB:', rapportId);

        return reply.status(204).send();
      } catch (error) {
        return feilRespons(reply, 500, 'Kunne ikke slette rapporten.', error);
      }
    },
  );

  // POST /api/pbi/query-sql — kjør SQL mot Azure SQL (kun ai_gold-views)
  fastify.post<{ Body: { sql: string } }>(
    '/api/pbi/query-sql',
    {
      preHandler: [resolveTenant, requireBruker],
      schema: {
        body: {
          type: 'object',
          required: ['sql'],
          properties: { sql: { type: 'string', minLength: 1 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { sql }   = request.body;
      const bruker    = (request as AuthRequest).bruker;
      const tenantReq = request as TenantRequest;

      // Tilgangskontroll (fail-closed): kun SELECT mot views brukeren har AI-tilgang til.
      const tilgang = await hentDatatilgang({
        erAdminTilgang: erAdmin(bruker?.rolle),
        entraObjectId:  bruker?.entraObjectId,
        tenantPrisma:   tenantReq.tenantPrisma,
        dbUrl:          tenantReq.tenantDatabaseUrl,
      });
      const validering = validerSqlMotTilgang(sql, tilgang);
      if (!validering.ok) {
        logger.warn('[query-sql] avvist:', validering.grunn, validering.avvisteViews);
        return reply.status(403).send({ error: 'Du har ikke tilgang til denne datakilden.' });
      }
      try {
        const rows = await queryAzureSQL(sql, 500);
        return reply.send({ rows });
      } catch (error) {
        return feilRespons(reply, 500, 'Kunne ikke kjøre spørringen.', error);
      }
    },
  );

  // GET /api/pbi/view-kolonner?viewNavn=ai_gold.vw_Fact_RUH — henter alle kolonner fra INFORMATION_SCHEMA
  fastify.get<{ Querystring: { viewNavn: string } }>(
    '/api/pbi/view-kolonner',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['viewNavn'],
          properties: { viewNavn: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const { viewNavn } = request.query;
      // Forventer format ai_gold.vw_Navn
      const parts = viewNavn.split('.');
      if (parts.length !== 2) return reply.status(400).send({ error: 'Ugyldig viewNavn, forventet schema.view_name' });
      // \p{L}\p{N} (med /u) bevarer æøå i view-navn — ASCII-only stripper trunkerer
      // f.eks. "vw_Fact_Leverandørstatistikk" til "vw_Fact_Leverandrstatistikk".
      const [schema, view] = parts.map(p => p.replace(/[^\p{L}\p{N}_]/gu, ''));
      try {
        // Prøv metadata-katalog først
        const metaRader = await queryAzureSQL(`
          SELECT k.kolonne_navn
          FROM ai_metadata_kolonner k
          JOIN ai_metadata_views v ON k.view_id = v.id
          WHERE v.schema_name = '${schema}' AND v.view_name = '${view}'
          AND v.er_aktiv = 1
          ORDER BY k.sort_order
        `);
        if (metaRader.length > 0) {
          return reply.send({ kolonner: metaRader.map(r => r['kolonne_navn'] as string) });
        }
        // Fallback: INFORMATION_SCHEMA
        const rows = await queryAzureSQL(`
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${view}'
          ORDER BY ORDINAL_POSITION
        `);
        return reply.send({ kolonner: rows.map(r => r['COLUMN_NAME'] as string) });
      } catch (error) {
        return feilRespons(reply, 500, 'Kunne ikke hente kolonner.', error);
      }
    },
  );
}
