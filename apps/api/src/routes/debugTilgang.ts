import type { FastifyInstance } from 'fastify';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';

export async function debugTilgangRoutes(fastify: FastifyInstance) {
  if (process.env.NODE_ENV === 'production') return;

  // GET /api/debug/tilgang?brukerId=&grupper=id1,id2,id3
  fastify.get<{ Querystring: { brukerId?: string; grupper?: string } }>(
    '/api/debug/tilgang',
    { preHandler: [resolveTenant] },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const { brukerId, grupper } = request.query;
      const grupperArray = grupper ? grupper.split(',').filter(Boolean) : [];

      if (!brukerId && grupperArray.length === 0) {
        return reply.status(400).send({
          error: 'Oppgi minst én av: brukerId, grupper',
        });
      }

      const orConditions: { entraId: string | { in: string[] } }[] = [];
      if (brukerId) orConditions.push({ entraId: brukerId });
      if (grupperArray.length > 0) orConditions.push({ entraId: { in: grupperArray } });

      const workspaces = await db.workspace.findMany({
        where: {
          tilgang: { some: { OR: orConditions } },
        },
        select: {
          id:   true,
          navn: true,
          tilgang: {
            where: { OR: orConditions },
            select: { entraId: true, type: true },
          },
        },
        orderBy: { navn: 'asc' },
      });

      const result = workspaces.map((ws) => {
        const treff = ws.tilgang;
        const matchetPå: 'bruker' | 'gruppe' | 'begge' =
          treff.some((t) => t.entraId === brukerId) &&
          treff.some((t) => grupperArray.includes(t.entraId))
            ? 'begge'
            : treff.some((t) => t.entraId === brukerId)
            ? 'bruker'
            : 'gruppe';

        return { id: ws.id, navn: ws.navn, matchetPå };
      });

      return reply.send({
        input:            { brukerId: brukerId ?? null, grupper: grupperArray },
        antallWorkspaces: result.length,
        workspaces:       result,
      });
    },
  );

  // GET /api/debug/min-tilgang/:brukerId
  fastify.get<{ Params: { brukerId: string } }>(
    '/api/debug/min-tilgang/:brukerId',
    { preHandler: [resolveTenant] },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const { brukerId } = request.params;

      const tilganger = await db.tilgang.findMany({
        where: { entraId: brukerId },
        select: {
          id:           true,
          type:         true,
          visningsnavn: true,
          epost:        true,
          rolle:        true,
          lagtTilDato:  true,
          workspace: {
            select: { id: true, navn: true },
          },
        },
        orderBy: { lagtTilDato: 'desc' },
      });

      return reply.send({
        brukerId,
        antallTilganger: tilganger.length,
        tilganger: tilganger.map((t) => ({
          workspaceId:   t.workspace.id,
          workspaceNavn: t.workspace.navn,
          rolle:         t.rolle,
          type:          t.type,
          visningsnavn:  t.visningsnavn,
          epost:         t.epost,
          lagtTilDato:   t.lagtTilDato,
        })),
      });
    },
  );
}
