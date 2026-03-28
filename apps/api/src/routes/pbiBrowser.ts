import type { FastifyInstance } from 'fastify';
import { getAzureToken } from './embedToken';

interface PbiGroup {
  id: string;
  name: string;
  type: string;
  capacityId?: string;
}

interface PbiGroupsResponse {
  value: PbiGroup[];
}

interface PbiReport {
  id: string;
  name: string;
  datasetId: string;
  webUrl: string;
  embedUrl: string;
}

interface PbiReportsResponse {
  value: PbiReport[];
}

async function getToken(): Promise<string> {
  const tenantId     = process.env.PBI_TENANT_ID;
  const clientId     = process.env.PBI_CLIENT_ID;
  const clientSecret = process.env.PBI_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Mangler Power BI-konfigurasjon på serveren.');
  }
  return getAzureToken(tenantId, clientId, clientSecret);
}

export async function pbiBrowserRoutes(fastify: FastifyInstance) {
  // GET /api/pbi/workspaces
  fastify.get('/api/pbi/workspaces', async (_request, reply) => {
    try {
      const token    = await getToken();
      const response = await fetch('https://api.powerbi.com/v1.0/myorg/groups', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const body = await response.text();
        return reply
          .status(502)
          .send({ error: `Power BI feilet med HTTP ${response.status}`, detail: body });
      }

      const data       = await response.json() as PbiGroupsResponse;
      const workspaces = data.value.map((g) => ({
        id:         g.id,
        name:       g.name,
        type:       g.type,
        capacityId: g.capacityId,
      }));

      return reply.send(workspaces);
    } catch (error) {
      fastify.log.error(error);
      return reply
        .status(500)
        .send({ error: error instanceof Error ? error.message : 'Kunne ikke hente PBI workspaces.' });
    }
  });

  // GET /api/pbi/workspaces/:pbiWorkspaceId/rapporter
  fastify.get<{ Params: { pbiWorkspaceId: string } }>(
    '/api/pbi/workspaces/:pbiWorkspaceId/rapporter',
    async (request, reply) => {
      try {
        const token              = await getToken();
        const { pbiWorkspaceId } = request.params;

        const response = await fetch(
          `https://api.powerbi.com/v1.0/myorg/groups/${pbiWorkspaceId}/reports`,
          { headers: { Authorization: `Bearer ${token}` } },
        );

        if (!response.ok) {
          const body = await response.text();
          return reply
            .status(502)
            .send({ error: `Power BI feilet med HTTP ${response.status}`, detail: body });
        }

        const data     = await response.json() as PbiReportsResponse;
        const rapporter = data.value.map((r) => ({
          id:        r.id,
          name:      r.name,
          datasetId: r.datasetId,
          webUrl:    r.webUrl,
          embedUrl:  r.embedUrl,
        }));

        return reply.send(rapporter);
      } catch (error) {
        fastify.log.error(error);
        return reply
          .status(500)
          .send({ error: error instanceof Error ? error.message : 'Kunne ikke hente PBI rapporter.' });
      }
    },
  );
}
