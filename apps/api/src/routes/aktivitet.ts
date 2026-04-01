import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireBruker, type AuthRequest } from '../middleware/auth';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';

export async function aktivitetRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/api/meg/aktivitet',
    { preHandler: [resolveTenant, requireBruker] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;

      // Sist åpnet rapport fra UserEvent (master-DB)
      const sistAapnet = await prisma.userEvent
        .findFirst({
          where: { userId: bruker.id, hendelsesType: 'åpnet_rapport' },
          orderBy: { tidspunkt: 'desc' },
          select: { referanseNavn: true, tidspunkt: true },
        })
        .catch(() => null);

      // Sist oppdatert rapport hentes fra tenant-DB med fallback til master
      const db = (request as TenantRequest).tenantPrisma ?? prisma;
      const sistOppdatert = await db.rapport
        .findFirst({
          where: { erAktiv: true },
          orderBy: { oppdatert: 'desc' },
          select: { navn: true, oppdatert: true },
        })
        .catch(() => null);

      return reply.send({
        sistInnlogget: bruker.forrigeInnlogget ?? null,
        sistAapnetRapport: sistAapnet
          ? { navn: sistAapnet.referanseNavn, dato: sistAapnet.tidspunkt }
          : null,
        sistOppdatertRapport: sistOppdatert
          ? { navn: sistOppdatert.navn, dato: sistOppdatert.oppdatert }
          : null,
      });
    },
  );
}
