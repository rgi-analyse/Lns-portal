import type { FastifyInstance } from 'fastify';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';

interface UpsertBody {
  brukerId: string;
  type: string;
  verdi: string;
}

export async function brukerInnstillingerRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', resolveTenant);

  // GET /api/innstillinger/:rapportId?brukerId=&type=
  fastify.get<{ Params: { rapportId: string }; Querystring: { brukerId?: string; type?: string } }>(
    '/api/innstillinger/:rapportId',
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const { rapportId } = request.params;
      const { brukerId, type = 'bookmark' } = request.query;

      if (!brukerId) {
        return reply.status(400).send({ error: 'Mangler brukerId.' });
      }

      try {
        const innstilling = await db.brukerInnstilling.findUnique({
          where: { brukerId_rapportId_type: { brukerId, rapportId, type } },
        });
        return reply.send(innstilling ?? null);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke hente innstilling.' });
      }
    },
  );

  // POST /api/innstillinger/:rapportId  (upsert)
  fastify.post<{ Params: { rapportId: string }; Body: UpsertBody }>(
    '/api/innstillinger/:rapportId',
    {
      schema: {
        body: {
          type: 'object',
          required: ['brukerId', 'type', 'verdi'],
          properties: {
            brukerId: { type: 'string', minLength: 1 },
            type:     { type: 'string', minLength: 1 },
            verdi:    { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const { rapportId } = request.params;
      const { brukerId, type, verdi } = request.body;

      try {
        const innstilling = await db.brukerInnstilling.upsert({
          where: { brukerId_rapportId_type: { brukerId, rapportId, type } },
          update: { verdi },
          create: { brukerId, rapportId, type, verdi },
        });
        return reply.status(200).send(innstilling);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke lagre innstilling.' });
      }
    },
  );

  // DELETE /api/innstillinger/:rapportId?brukerId=&type=
  fastify.delete<{ Params: { rapportId: string }; Querystring: { brukerId?: string; type?: string } }>(
    '/api/innstillinger/:rapportId',
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const { rapportId } = request.params;
      const { brukerId, type = 'bookmark' } = request.query;

      if (!brukerId) {
        return reply.status(400).send({ error: 'Mangler brukerId.' });
      }

      try {
        await db.brukerInnstilling.delete({
          where: { brukerId_rapportId_type: { brukerId, rapportId, type } },
        });
        return reply.status(204).send();
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke slette innstilling.' });
      }
    },
  );
}
