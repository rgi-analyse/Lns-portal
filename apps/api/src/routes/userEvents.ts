import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireBruker, type AuthRequest } from '../middleware/auth';

interface LoggBody {
  hendelsesType: string;
  referanseId?: string;
  referanseNavn?: string;
  verdi?: Record<string, unknown>;
}

async function oppdaterUserProfile(userId: string): Promise<void> {
  const tredveDAgerSiden = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const hendelser = await prisma.userEvent.findMany({
    where: { userId, hendelsesType: 'åpnet_rapport', tidspunkt: { gte: tredveDAgerSiden } },
    orderBy: { tidspunkt: 'desc' },
    select: { referanseNavn: true },
  });

  const telling: Record<string, number> = {};
  for (const h of hendelser) {
    if (h.referanseNavn) telling[h.referanseNavn] = (telling[h.referanseNavn] ?? 0) + 1;
  }
  const topRapporter = Object.entries(telling)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([navn, antall]) => ({ navn, antall }));

  const aiKontekst = JSON.stringify({ topRapporter, oppdatert: new Date().toISOString() });

  await prisma.userProfile.upsert({
    where:  { userId },
    update: { aiKontekst, lastActivity: new Date() },
    create: { userId, aiKontekst, lastActivity: new Date() },
  });
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
      }).then(() => {
        // Oppdater aiKontekst i UserProfile ved rapport-åpning
        if (hendelsesType === 'åpnet_rapport') {
          oppdaterUserProfile(bruker.id).catch(() => {});
        }
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
