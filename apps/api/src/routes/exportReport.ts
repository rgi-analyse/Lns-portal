import type { FastifyInstance } from 'fastify';
import { getAzureToken } from './embedToken';

type ExportFormat = 'PDF' | 'PPTX';
type ExportStatus = 'NotStarted' | 'Running' | 'Succeeded' | 'Failed';

interface ExportJob {
  id: string;
  percentComplete: number;
  status: ExportStatus;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  PDF: 'application/pdf',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const EXTENSIONS: Record<ExportFormat, string> = {
  PDF: 'pdf',
  PPTX: 'pptx',
};

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // 60 sekunder maks

async function pollUntilDone(
  workspaceId: string,
  reportId: string,
  exportId: string,
  azureToken: string
): Promise<void> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const response = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${reportId}/exports/${exportId}`,
      { headers: { Authorization: `Bearer ${azureToken}` } }
    );

    if (!response.ok) {
      throw new Error(`Poll feilet med HTTP ${response.status}: ${await response.text()}`);
    }

    const job = await response.json() as ExportJob;
    console.log(`Eksport status [${i + 1}/${MAX_POLLS}]: ${job.status} (${job.percentComplete}%)`);

    if (job.status === 'Succeeded') return;
    if (job.status === 'Failed') throw new Error('Power BI eksport feilet.');
  }

  throw new Error(`Eksport tidsavbrudd etter ${(MAX_POLLS * POLL_INTERVAL_MS) / 1000} sekunder.`);
}

export async function exportReportRoutes(fastify: FastifyInstance) {
  fastify.post('/api/export-report', async (request, reply) => {
    const tenantId = process.env.PBI_TENANT_ID;
    const clientId = process.env.PBI_CLIENT_ID;
    const clientSecret = process.env.PBI_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      return reply.status(500).send({ error: 'Mangler Power BI-konfigurasjon på serveren.' });
    }

    const { format = 'PDF', pbiReportId, pbiWorkspaceId } =
      (request.body ?? {}) as { format?: ExportFormat; pbiReportId?: string; pbiWorkspaceId?: string };

    if (!pbiReportId || !pbiWorkspaceId) {
      return reply.status(400).send({ error: 'Mangler pbiReportId eller pbiWorkspaceId i request body.' });
    }

    if (!['PDF', 'PPTX'].includes(format)) {
      return reply.status(400).send({ error: `Ugyldig format: ${format}. Tillatte verdier: PDF, PPTX.` });
    }

    const workspaceId = pbiWorkspaceId;
    const reportId    = pbiReportId;

    try {
      const azureToken = await getAzureToken(tenantId, clientId, clientSecret);

      const startResponse = await fetch(
        `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${reportId}/ExportTo`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${azureToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ format }),
        }
      );

      if (!startResponse.ok) {
        throw new Error(`Kunne ikke starte eksport: HTTP ${startResponse.status}: ${await startResponse.text()}`);
      }

      const { id: exportId } = await startResponse.json() as { id: string };
      console.log(`Eksport startet (${format}), exportId: ${exportId}`);

      await pollUntilDone(workspaceId, reportId, exportId, azureToken);

      const fileResponse = await fetch(
        `https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/reports/${reportId}/exports/${exportId}/file`,
        { headers: { Authorization: `Bearer ${azureToken}` } }
      );

      if (!fileResponse.ok) {
        throw new Error(`Kunne ikke hente eksportfil: HTTP ${fileResponse.status}`);
      }

      const buffer = Buffer.from(await fileResponse.arrayBuffer());

      return reply
        .header('Content-Type', CONTENT_TYPES[format])
        .header('Content-Disposition', `attachment; filename="rapport.${EXTENSIONS[format]}"`)
        .send(buffer);
    } catch (error) {
      console.error('Eksport feil:', error);
      fastify.log.error(error);
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Ukjent feil under eksport.',
      });
    }
  });
}
