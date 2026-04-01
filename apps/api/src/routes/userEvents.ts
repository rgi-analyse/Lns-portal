import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireBruker, type AuthRequest } from '../middleware/auth';

interface LoggBody {
  hendelsesType: string;
  referanseId?: string;
  referanseNavn?: string;
  verdi?: Record<string, unknown>;
}

export async function userEventRoutes(fastify: FastifyInstance) {
  // POST /api/meg/logg — logg en hendelse (fire-and-forget fra portal)
  fastify.post<{ Body: LoggBody }>(
    '/api/meg/logg',
    {
      preHandler: [requireBruker],
      schema: {
        body: {
          type: 'object',
          required: ['hendelsesType'],
          properties: {
            hendelsesType: { type: 'string' },
            referanseId:   { type: 'string' },
            referanseNavn: { type: 'string' },
            verdi:         { type: 'object' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const { hendelsesType, referanseId, referanseNavn, verdi } = request.body;

      // Svar UMIDDELBART — ikke vent på DB
      reply.status(202).send({ ok: true });

      const nå = new Date();

      // Skriv UserEvent asynkront i bakgrunnen
      prisma.userEvent.create({
        data: {
          userId:        bruker.id,
          hendelsesType,
          referanseId:   referanseId   ?? null,
          referanseNavn: referanseNavn ?? null,
          verdi:         verdi ? JSON.stringify(verdi) : null,
          tenantSlug:    (request.headers['x-tenant-id'] as string) ?? 'lns',
        },
      }).catch(err => fastify.log.error(err, '[userEvents] logg feilet'));

      // Oppdater UserProfile.lastActivity asynkront
      prisma.userProfile.upsert({
        where:  { userId: bruker.id },
        update: { lastActivity: nå },
        create: { userId: bruker.id, lastActivity: nå },
      }).catch(() => {});
    },
  );
}
