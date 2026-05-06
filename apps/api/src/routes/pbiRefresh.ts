import type { FastifyInstance } from 'fastify';
import { getAzureToken } from './embedToken';

interface RefreshEntry {
  id?: string;
  requestId?: string;
  refreshType?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
  serviceExceptionJson?: string;
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
  fastify.post<{ Body: { pbiDatasetId?: string; pbiWorkspaceId?: string } }>(
    '/api/pbi/refresh',
    async (request, reply) => {
      const { pbiDatasetId, pbiWorkspaceId } = request.body ?? {};
      if (!pbiDatasetId || !pbiWorkspaceId) {
        return reply.status(400).send({ error: 'Mangler pbiDatasetId eller pbiWorkspaceId.' });
      }

      const tenantId     = process.env.PBI_TENANT_ID;
      const clientId     = process.env.PBI_CLIENT_ID;
      const clientSecret = process.env.PBI_CLIENT_SECRET;
      if (!tenantId || !clientId || !clientSecret) {
        return reply.status(500).send({ error: 'Mangler Power BI-konfigurasjon på serveren.' });
      }

      try {
        const token = await getAzureToken(tenantId, clientId, clientSecret);
        const res = await fetch(
          `https://api.powerbi.com/v1.0/myorg/groups/${pbiWorkspaceId}/datasets/${pbiDatasetId}/refreshes`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ notifyOption: 'NoNotification' }),
          },
        );

        if (res.status === 202) {
          // PBI returnerer Location-header pålitelig kun for enhanced refresh.
          // For basic refresh (kun notifyOption) faller vi tilbake på RequestId-
          // headeren og deretter siste entry i refresh-historikken.
          const location = res.headers.get('location') ?? '';
          let refreshId: string | null = location
            ? (location.split('/').filter(Boolean).pop() ?? null)
            : null;

          if (!refreshId) {
            refreshId = res.headers.get('requestid') ?? null;
          }

          if (!refreshId) {
            try {
              const histRes = await fetch(
                `https://api.powerbi.com/v1.0/myorg/groups/${pbiWorkspaceId}/datasets/${pbiDatasetId}/refreshes?$top=1`,
                { headers: { Authorization: `Bearer ${token}` } },
              );
              if (histRes.ok) {
                const histData = await histRes.json() as RefreshHistoryResponse;
                const siste = histData.value?.[0];
                refreshId = siste?.requestId ?? siste?.id ?? null;
              }
            } catch (e) {
              fastify.log.warn(e, '[pbiRefresh] history-fallback feilet');
            }
          }

          if (!refreshId) {
            return reply.status(500).send({ error: 'Klarte ikke å lese refreshId fra PBI-respons' });
          }
          return reply.status(202).send({ ok: true, refreshId });
        }
        const body = await res.text().catch(() => '');
        fastify.log.error(`[pbiRefresh] PBI svarte ${res.status}: ${body}`);
        return reply.status(res.status).send({ error: `PBI svarte ${res.status}`, detail: body });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: err instanceof Error ? err.message : 'Ukjent feil.' });
      }
    },
  );

  fastify.get<{ Querystring: { datasetId?: string; workspaceId?: string; refreshId?: string } }>(
    '/api/pbi/refresh-status',
    async (request, reply) => {
      const { datasetId, workspaceId, refreshId } = request.query;
      if (!datasetId || !workspaceId || !refreshId) {
        return reply.status(400).send({ error: 'Mangler datasetId, workspaceId eller refreshId.' });
      }

      const tenantId     = process.env.PBI_TENANT_ID;
      const clientId     = process.env.PBI_CLIENT_ID;
      const clientSecret = process.env.PBI_CLIENT_SECRET;
      if (!tenantId || !clientId || !clientSecret) {
        return reply.status(500).send({ error: 'Mangler Power BI-konfigurasjon på serveren.' });
      }

      try {
        const token   = await getAzureToken(tenantId, clientId, clientSecret);
        const headers = { Authorization: `Bearer ${token}` };

        // Prøv først direkte GET (virker for enhanced refresh).
        const direct = await fetch(
          `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/refreshes/${refreshId}`,
          { headers },
        );

        if (direct.ok) {
          const entry = await direct.json() as RefreshEntry;
          return reply.send({
            status:    entry.status ?? 'Unknown',
            startTime: entry.startTime ?? null,
            endTime:   entry.endTime ?? null,
            error:     entry.serviceExceptionJson ?? null,
          });
        }

        // Fallback: hent fra history-liste og match på requestId (basic refresh).
        const histRes = await fetch(
          `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/refreshes?$top=20`,
          { headers },
        );
        if (!histRes.ok) {
          const body = await histRes.text().catch(() => '');
          fastify.log.error(`[pbiRefresh] status-history svarte ${histRes.status}: ${body}`);
          return reply.status(histRes.status).send({ error: `PBI svarte ${histRes.status}`, detail: body });
        }
        const data  = await histRes.json() as RefreshHistoryResponse;
        const entry = data.value?.find((r) => (r.requestId ?? r.id) === refreshId);

        if (!entry) {
          // Refresh kan være så ny at den ikke har dukket opp i historikken ennå.
          return reply.send({ status: 'Unknown', startTime: null, endTime: null, error: null });
        }
        return reply.send({
          status:    entry.status ?? 'Unknown',
          startTime: entry.startTime ?? null,
          endTime:   entry.endTime ?? null,
          error:     entry.serviceExceptionJson ?? null,
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: err instanceof Error ? err.message : 'Ukjent feil.' });
      }
    },
  );

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
