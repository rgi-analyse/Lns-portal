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

      // BrukerInnstilling bor i master-DB
      const sistAapnet = await prisma.brukerInnstilling
        .findFirst({
          where: { brukerId: bruker.id, type: 'sistAapnet' },
          orderBy: { oppdatert: 'desc' },
          select: { verdi: true, oppdatert: true },
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
        sistInnlogget: bruker.sistInnlogget ?? null,
        sistAapnetRapport: sistAapnet
          ? {
              navn: (() => {
                try { return JSON.parse(sistAapnet.verdi)?.navn ?? null; }
                catch { return sistAapnet.verdi ?? null; }
              })(),
              dato: sistAapnet.oppdatert,
            }
          : null,
        sistOppdatertRapport: sistOppdatert
          ? { navn: sistOppdatert.navn, dato: sistOppdatert.oppdatert }
          : null,
      });
    },
  );
}
