import type { FastifyInstance } from 'fastify';
import { requireBruker } from '../middleware/auth';

export async function speechRoutes(fastify: FastifyInstance) {
  fastify.get('/api/speech/token', { preHandler: [requireBruker] }, async (_request, reply) => {
    const key    = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;

    fastify.log.info(`[Speech] key finnes: ${!!key}, key lengde: ${key?.length ?? 0}, region: ${region}`);

    if (!key || !region) {
      return reply.status(503).send({ error: 'AZURE_SPEECH_KEY eller AZURE_SPEECH_REGION mangler i .env' });
    }

    const url = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
    fastify.log.info(`[Speech] kaller Azure: ${url}`);

    const tokenRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    fastify.log.info(`[Speech] Azure status: ${tokenRes.status}`);

    if (!tokenRes.ok) {
      const feil = await tokenRes.text().catch(() => '');
      fastify.log.error(`[Speech] Azure feil: ${tokenRes.status} - ${feil}`);
      return reply.status(500).send({ error: `Azure Speech feil: ${tokenRes.status}`, detaljer: feil });
    }

    const token = await tokenRes.text();
    return reply.send({
      token,
      region,
      expires: Date.now() + 9 * 60 * 1000,
    });
  });
}
