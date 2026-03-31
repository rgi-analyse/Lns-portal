import type { FastifyInstance } from 'fastify';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';

interface CreateBody {
  type: string;
  entraId: string;
  visningsnavn: string;
  epost?: string;
  rolle: string;
}

export async function rapportTilgangRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', resolveTenant);

  // GET /api/rapporter/:id/tilgang
  fastify.get<{ Params: { id: string } }>(
    '/api/rapporter/:id/tilgang',
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      try {
        const rapport = await db.rapport.findUnique({
          where: { id: request.params.id },
          select: { id: true },
        });
        if (!rapport) return reply.status(404).send({ error: 'Rapport ikke funnet.' });

        const tilganger = await db.rapportTilgang.findMany({
          where: { rapportId: request.params.id },
          orderBy: { lagtTilDato: 'desc' },
        });
        return reply.send(tilganger);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke hente tilganger.' });
      }
    },
  );

  // POST /api/rapporter/:id/tilgang
  fastify.post<{ Params: { id: string }; Body: CreateBody }>(
    '/api/rapporter/:id/tilgang',
    {
      schema: {
        body: {
          type: 'object',
          required: ['type', 'entraId', 'visningsnavn', 'rolle'],
          properties: {
            type:         { type: 'string', minLength: 1 },
            entraId:      { type: 'string', minLength: 1 },
            visningsnavn: { type: 'string', minLength: 1 },
            epost:        { type: 'string' },
            rolle:        { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      try {
        const rapport = await db.rapport.findUnique({
          where: { id: request.params.id },
          select: { id: true },
        });
        if (!rapport) return reply.status(404).send({ error: 'Rapport ikke funnet.' });

        const existing = await db.rapportTilgang.findFirst({
          where: { rapportId: request.params.id, entraId: request.body.entraId },
          select: { id: true },
        });
        if (existing) {
          return reply
            .status(409)
            .send({ error: 'Denne gruppen/brukeren har allerede tilgang til denne rapporten.' });
        }

        const tilgang = await db.rapportTilgang.create({
          data: { ...request.body, rapportId: request.params.id },
        });
        return reply.status(201).send(tilgang);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke legge til tilgang.' });
      }
    },
  );

  // DELETE /api/rapporter/:id/tilgang/:tilgangId
  fastify.delete<{ Params: { id: string; tilgangId: string } }>(
    '/api/rapporter/:id/tilgang/:tilgangId',
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      try {
        const existing = await db.rapportTilgang.findFirst({
          where: { id: request.params.tilgangId, rapportId: request.params.id },
          select: { id: true },
        });
        if (!existing) return reply.status(404).send({ error: 'Tilgang ikke funnet.' });

        await db.rapportTilgang.delete({ where: { id: request.params.tilgangId } });
        return reply.status(204).send();
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke fjerne tilgang.' });
      }
    },
  );
}
