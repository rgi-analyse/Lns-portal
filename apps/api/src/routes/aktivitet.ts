import type { FastifyInstance } from 'fastify';
import { requireBruker, type AuthRequest } from '../middleware/auth';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';

export async function aktivitetRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/api/meg/aktivitet',
    { preHandler: [requireBruker, resolveTenant] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const db = (request as TenantRequest).tenantPrisma;

      // Sist åpnet rapport fra BrukerInnstilling
      const sistAapnet = await db.brukerInnstilling
        .findFirst({
          where: { brukerId: bruker.id, type: 'sistAapnet' },
          orderBy: { oppdatert: 'desc' },
          select: { verdi: true, oppdatert: true },
        })
        .catch(() => null);

      // Sist oppdatert rapport i tenanten
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
