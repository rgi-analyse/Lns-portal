import type { FastifyInstance } from 'fastify';
import { feilRespons } from '../lib/feilRespons';
import * as mssql from 'mssql';
import { getAzureToken } from '../lib/azureToken';
import { logger } from '../lib/logger';

const server   = process.env.FABRIC_SQL_SERVER   ?? '';
const database = process.env.FABRIC_SQL_DATABASE ?? '';
const tenantId = process.env.PBI_TENANT_ID       ?? '';
const clientId = process.env.PBI_CLIENT_ID       ?? '';
const clientSecret = process.env.PBI_CLIENT_SECRET ?? '';

export interface ReportContext {
  ReportId: string;
  ReportName: string;
  DatasetId: string;
  SubjectArea: string;
  BusinessDescription: string;
  Keywords: string;
  IsCrossReportEnabled: boolean;
}

async function getPool(): Promise<mssql.ConnectionPool> {
  const token = await getAzureToken(
    tenantId,
    clientId,
    clientSecret,
    'https://database.windows.net/.default',
  );
  const config: mssql.config = {
    server,
    database,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: { type: 'azure-active-directory-access-token', options: { token } },
  };
  const pool = new mssql.ConnectionPool(config);
  await pool.connect();
  return pool;
}

export async function getReportContext(rapportId: string): Promise<ReportContext | null> {
  const pool = await getPool();
  try {
    const result = await pool.request()
      .input('rapportId', mssql.NVarChar, rapportId)
      .query(`
        SELECT DISTINCT
          ReportId,
          ReportName,
          DatasetId,
          SubjectArea,
          BusinessDescription,
          Keywords,
          IsCrossReportEnabled
        FROM ai_gold.vw_Chat_ReportCatalog
        WHERE ReportId = @rapportId
      `);

    if (result.recordset.length === 0) return null;
    return result.recordset[0] as ReportContext;
  } finally {
    await pool.close();
  }
}

export async function reportContextRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { rapportId: string } }>(
    '/api/report-context/:rapportId',
    async (request, reply) => {
      const { rapportId } = request.params;
      logger.debug('[ReportContext] Henter kontekst for:', rapportId);

      try {
        const context = await getReportContext(rapportId);
        if (!context) {
          return reply.status(404).send({ error: 'Rapport ikke funnet i katalog' });
        }
        logger.debug('[ReportContext] Hentet:', context.ReportName);
        return reply.send(context);
      } catch (err) {
        return feilRespons(reply, 500, 'Kunne ikke hente rapport-kontekst.', err);
      }
    },
  );
}
