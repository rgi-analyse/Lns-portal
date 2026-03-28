import type { FastifyInstance } from 'fastify';
import { getAzureToken } from './embedToken';

export async function debugPbiRoutes(fastify: FastifyInstance) {
  fastify.get('/api/debug-pbi', async (request, reply) => {
    const tenantId = process.env.PBI_TENANT_ID;
    const clientId = process.env.PBI_CLIENT_ID;
    const clientSecret = process.env.PBI_CLIENT_SECRET;
    const workspaceId = process.env.PBI_WORKSPACE_ID;
    const reportId = process.env.PBI_REPORT_ID;

    if (!tenantId || !clientId || !clientSecret || !workspaceId || !reportId) {
      return reply.status(500).send({ error: 'Mangler Power BI-konfigurasjon på serveren.' });
    }

    const azureToken = await getAzureToken(tenantId, clientId, clientSecret);

    const url = `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${reportId}`;
    const pbiResponse = await fetch(url, {
      headers: { Authorization: `Bearer ${azureToken}` },
    });

    const body = await pbiResponse.text();

    return reply.status(pbiResponse.status).send({
      status: pbiResponse.status,
      body: JSON.parse(body),
    });
  });
}
