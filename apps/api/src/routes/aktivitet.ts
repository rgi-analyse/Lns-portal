import type { FastifyInstance } from 'fastify';
import { requireBruker, type AuthRequest } from '../middleware/auth';
import { queryAzureSQL } from '../services/azureSqlService';

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9\-]/g, '');
}

export async function aktivitetRoutes(fastify: FastifyInstance) {
  // GET /api/meg/aktivitet
  // Returnerer tidspunktet for brukerens siste aktivitet (siste gang de interagerte med en rapport).
  fastify.get('/api/meg/aktivitet', { preHandler: [requireBruker] }, async (request, reply) => {
    const { id } = (request as AuthRequest).bruker;
    try {
      const rows = await queryAzureSQL(
        `SELECT MAX(oppdatert) AS sisteAktiv FROM BrukerInnstilling WHERE brukerId = '${safeId(id)}'`,
      );
      const raw = (rows[0] as { sisteAktiv?: string | null } | undefined)?.sisteAktiv ?? null;
      return reply.send({ sisteAktiv: raw });
    } catch {
      return reply.send({ sisteAktiv: null });
    }
  });
}
