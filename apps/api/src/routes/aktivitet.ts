import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireBruker, type AuthRequest } from '../middleware/auth';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';
import { queryAzureSQL } from '../services/azureSqlService';

async function hentErDesignerRapport(id: string | null | undefined): Promise<boolean> {
  if (!id) return false;
  const safeId = id.replace(/[^a-zA-Z0-9\-]/g, '');
  if (!safeId) return false;
  try {
    const rows = await queryAzureSQL(`SELECT erDesignerRapport FROM Rapport WHERE id = '${safeId}'`);
    return Boolean((rows[0] as { erDesignerRapport?: unknown } | undefined)?.erDesignerRapport);
  } catch {
    return false;
  }
}

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
          select: { referanseId: true, referanseNavn: true, tidspunkt: true },
        })
        .catch(() => null);

      // Sist oppdatert rapport hentes fra tenant-DB med fallback til master
      const db = (request as TenantRequest).tenantPrisma ?? prisma;
      const sistOppdatert = await db.rapport
        .findFirst({
          where: { erAktiv: true },
          orderBy: { oppdatert: 'desc' },
          select: { id: true, navn: true, oppdatert: true },
        })
        .catch(() => null);

      const [aapnetErDesigner, oppdatertErDesigner] = await Promise.all([
        hentErDesignerRapport(sistAapnet?.referanseId ?? null),
        hentErDesignerRapport(sistOppdatert?.id ?? null),
      ]);

      return reply.send({
        sistInnlogget: bruker.forrigeInnlogget ?? null,
        sistAapnetRapport: sistAapnet
          ? {
              id: sistAapnet.referanseId,
              navn: sistAapnet.referanseNavn,
              dato: sistAapnet.tidspunkt,
              erDesignerRapport: aapnetErDesigner,
            }
          : null,
        sistOppdatertRapport: sistOppdatert
          ? {
              id: sistOppdatert.id,
              navn: sistOppdatert.navn,
              dato: sistOppdatert.oppdatert,
              erDesignerRapport: oppdatertErDesigner,
            }
          : null,
      });
    },
  );
}
