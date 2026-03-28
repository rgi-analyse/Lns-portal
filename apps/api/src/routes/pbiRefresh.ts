import type { FastifyInstance } from 'fastify';
import { getAzureToken } from './embedToken';

interface RefreshEntry {
  id?: string;
  refreshType?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
}

interface RefreshHistoryResponse {
  value?: RefreshEntry[];
}

interface RefreshScheduleResponse {
  enabled?: boolean;
  days?: string[];
  times?: string[];
  localTimeZoneId?: string;
  notifyOption?: string;
}

export async function pbiRefreshRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { datasetId?: string; workspaceId?: string } }>(
    '/api/pbi/refresh-info',
    async (request, reply) => {
      const { datasetId, workspaceId } = request.query;
      if (!datasetId || !workspaceId) {
        return reply.status(400).send({ error: 'Mangler datasetId eller workspaceId.' });
      }

      const tenantId     = process.env.PBI_TENANT_ID;
      const clientId     = process.env.PBI_CLIENT_ID;
      const clientSecret = process.env.PBI_CLIENT_SECRET;
      if (!tenantId || !clientId || !clientSecret) {
        return reply.status(500).send({ error: 'Mangler Power BI-konfigurasjon på serveren.' });
      }

      try {
        const token = await getAzureToken(tenantId, clientId, clientSecret);
        const headers = { Authorization: `Bearer ${token}` };

        const [historyRes, scheduleRes] = await Promise.all([
          fetch(
            `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/refreshes?$top=1`,
            { headers },
          ),
          fetch(
            `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/refreshSchedule`,
            { headers },
          ),
        ]);

        const historyData  = historyRes.ok  ? await historyRes.json()  as RefreshHistoryResponse  : null;
        const scheduleData = scheduleRes.ok ? await scheduleRes.json() as RefreshScheduleResponse : null;

        console.log('[RefreshInfo] history:', JSON.stringify(historyData));
        console.log('[RefreshInfo] schedule:', JSON.stringify(scheduleData));

        const sisteEntry = historyData?.value?.[0];

        return reply.send({
          sisteRefresh: {
            tidspunkt: sisteEntry?.endTime ?? sisteEntry?.startTime ?? null,
            status:    sisteEntry?.status ?? null,
          },
          schedule: {
            aktivert:  scheduleData?.enabled   ?? false,
            tidspunkter: scheduleData?.times   ?? [],
            dager:     scheduleData?.days      ?? [],
            tidssone:  scheduleData?.localTimeZoneId ?? null,
          },
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: err instanceof Error ? err.message : 'Ukjent feil.' });
      }
    },
  );
}
