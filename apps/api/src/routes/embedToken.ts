import type { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';
import { getAzureToken } from '../lib/azureToken';
import { feilRespons } from '../lib/feilRespons';
export { getAzureToken };

interface PbiReport {
  embedUrl: string;
}

interface PbiEmbedToken {
  token: string;
  tokenId: string;
}

type ErrorSource = 'Azure AD' | 'Power BI – rapport' | 'Power BI – embed token';

class ApiError extends Error {
  constructor(
    public readonly source: ErrorSource,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`${source} feilet med HTTP ${status}`);
  }
}

async function assertOk(response: Response, source: ErrorSource): Promise<void> {
  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(source, response.status, body);
  }
}

interface EmbedTokenBody {
  rapportId?: string;      // Portal DB-ID → slår opp PBI-IDer fra DB
  pbiReportId?: string;    // Direkte PBI Report ID
  pbiDatasetId?: string;   // Direkte PBI Dataset ID
  pbiWorkspaceId?: string; // Direkte PBI Workspace ID
  reportId?: string;       // Legacy alias for pbiReportId
  datasetId?: string;      // Legacy alias for pbiDatasetId
}

export async function embedTokenRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: EmbedTokenBody }>(
    '/api/embed-token',
    {
      preHandler: [resolveTenant],
      schema: {
        body: {
          type: 'object',
          properties: {
            rapportId:      { type: 'string' },
            pbiReportId:    { type: 'string' },
            pbiDatasetId:   { type: 'string' },
            pbiWorkspaceId: { type: 'string' },
            reportId:       { type: 'string' },
            datasetId:      { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
    const tenantId    = process.env.PBI_TENANT_ID;
    const clientId    = process.env.PBI_CLIENT_ID;
    const clientSecret = process.env.PBI_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      return reply.status(500).send({ error: 'Mangler Power BI-konfigurasjon på serveren.' });
    }

    // Hent PBI-IDer: enten fra DB via rapportId, eller fra body/env som fallback
    let reportId: string | undefined;
    let datasetId: string | undefined;
    let workspaceId: string | undefined;

    logger.debug('[embedToken] body mottatt:', JSON.stringify(request.body));

    if (request.body?.rapportId) {
      const db = (request as TenantRequest).tenantPrisma;
      const dbRapport = await db.rapport.findUnique({
        where: { id: request.body.rapportId },
        select: { pbiReportId: true, pbiDatasetId: true, pbiWorkspaceId: true },
      });
      if (!dbRapport) {
        return reply.status(404).send({ error: 'Rapport ikke funnet.' });
      }
      reportId    = dbRapport.pbiReportId;
      datasetId   = dbRapport.pbiDatasetId;
      workspaceId = dbRapport.pbiWorkspaceId;
    } else {
      reportId    = request.body?.pbiReportId    ?? request.body?.reportId    ?? process.env.PBI_REPORT_ID;
      datasetId   = request.body?.pbiDatasetId   ?? request.body?.datasetId   ?? process.env.PBI_DATASET_ID;
      workspaceId = request.body?.pbiWorkspaceId ??                              process.env.PBI_WORKSPACE_ID;
    }

    logger.debug('[embedToken] reportId brukt:', reportId);
    logger.debug('[embedToken] workspaceId brukt:', workspaceId);
    logger.debug('[embedToken] datasetId brukt:', datasetId);

    if (!workspaceId || !reportId || !datasetId) {
      return reply.status(500).send({ error: 'Mangler Power BI-konfigurasjon på serveren.' });
    }

    try {
      const azureToken = await getAzureToken(tenantId, clientId, clientSecret);

      const parts = azureToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as {
        aud?: string;
        roles?: string[];
        scp?: string;
        appid?: string;
      };
      logger.debug('Azure AD token payload:', {
        aud: payload.aud,
        roles: payload.roles,
        scp: payload.scp,
        appid: payload.appid,
      });

      logger.debug('[embedToken] GenerateToken med:', { reportId, workspaceId, datasetId });
      const generateTokenUrl = 'https://api.powerbi.com/v1.0/myorg/GenerateToken';
      const generateTokenBody = {
        datasets: [{ id: datasetId }],
        reports: [{ id: reportId, allowEdit: false }],
        targetWorkspaces: [{ id: workspaceId }],
      };

      logger.debug('Power BI GenerateToken-kall:', {
        url: generateTokenUrl,
        headers: {
          Authorization: `Bearer ${azureToken.slice(0, 20)}...`,
          'Content-Type': 'application/json',
        },
        body: generateTokenBody,
      });

      const [reportResponse, tokenResponse] = await Promise.all([
        fetch(
          `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${reportId}`,
          { headers: { Authorization: `Bearer ${azureToken}` } }
        ),
        fetch(generateTokenUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${azureToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(generateTokenBody),
        }),
      ]);

      await assertOk(reportResponse, 'Power BI – rapport');
      await assertOk(tokenResponse, 'Power BI – embed token');

      const [report, tokenData] = await Promise.all([
        reportResponse.json() as Promise<PbiReport>,
        tokenResponse.json() as Promise<PbiEmbedToken>,
      ]);

      return {
        embedUrl: report.embedUrl,
        accessToken: tokenData.token,
        tokenId: tokenData.tokenId,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        return feilRespons(reply, 502, 'Kunne ikke hente embed-token.', error);
      }
      return feilRespons(reply, 500, 'Kunne ikke hente embed-token.', error);
    }
  });
}
