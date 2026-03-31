import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireBruker, requireAdmin } from '../middleware/auth';

interface TemaBody {
  organisasjonNavn?: string;
  primaryColor?: string;
  backgroundColor?: string;
  navyColor?: string;
  accentColor?: string;
  textColor?: string;
  textMutedColor?: string;
  logoUrl?: string | null;
}

export async function temaRoutes(fastify: FastifyInstance) {
  // GET /api/tema — åpent, brukes av ThemeProvider ved oppstart
  fastify.get('/api/tema', async (_request, reply) => {
    try {
      const tema = await prisma.organisasjonTema.findFirst({
        orderBy: { opprettet: 'asc' },
      });
      if (!tema) {
        return reply.send({
          primaryColor: '#F5A623',
          backgroundColor: '#0a1628',
          navyColor: '#1B2A4A',
          accentColor: '#243556',
          textColor: '#FFFFFF',
          textMutedColor: 'rgba(255,255,255,0.65)',
          logoUrl: null,
          organisasjonNavn: 'LNS',
        });
      }
      return reply.send(tema);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Kunne ikke hente tema.' });
    }
  });

  // GET /api/admin/tema — alle temaer (admin)
  fastify.get(
    '/api/admin/tema',
    { preHandler: [requireBruker, requireAdmin] },
    async (_request, reply) => {
      const temaer = await prisma.organisasjonTema.findMany({
        orderBy: { organisasjonNavn: 'asc' },
      });
      return reply.send(temaer);
    },
  );

  // POST /api/admin/tema — opprett nytt tema
  fastify.post<{ Body: TemaBody }>(
    '/api/admin/tema',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      try {
        const tema = await prisma.organisasjonTema.create({ data: request.body as Parameters<typeof prisma.organisasjonTema.create>[0]['data'] });
        return reply.status(201).send(tema);
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'P2002') {
          return reply.status(409).send({ error: 'Organisasjonsnavn er allerede i bruk.' });
        }
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Kunne ikke opprette tema.' });
      }
    },
  );

  // PATCH /api/admin/tema/:id — oppdater tema
  fastify.patch<{ Params: { id: string }; Body: TemaBody }>(
    '/api/admin/tema/:id',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      try {
        const tema = await prisma.organisasjonTema.update({
          where: { id: request.params.id },
          data: request.body as Parameters<typeof prisma.organisasjonTema.update>[0]['data'],
        });
        return reply.send(tema);
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'P2025') {
          return reply.status(404).send({ error: 'Tema ikke funnet.' });
        }
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Kunne ikke oppdatere tema.' });
      }
    },
  );

  // DELETE /api/admin/tema/:id — slett tema
  fastify.delete<{ Params: { id: string } }>(
    '/api/admin/tema/:id',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      try {
        await prisma.organisasjonTema.delete({ where: { id: request.params.id } });
        return reply.status(204).send();
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'P2025') {
          return reply.status(404).send({ error: 'Tema ikke funnet.' });
        }
        return reply.status(500).send({ error: 'Kunne ikke slette tema.' });
      }
    },
  );
}
