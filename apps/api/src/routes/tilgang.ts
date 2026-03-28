import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { searchGroups, searchUsers } from '../services/graphService';

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2025'
  );
}

interface CreateTilgangBody {
  type: string;
  entraId: string;
  visningsnavn: string;
  epost?: string;
  rolle: string;
}

export async function tilgangRoutes(fastify: FastifyInstance) {
  // GET /api/graph/search/grupper?q=
  fastify.get<{ Querystring: { q?: string } }>(
    '/api/graph/search/grupper',
    async (request, reply) => {
      const q = request.query.q?.trim() ?? '';
      if (!q) return reply.send([]);
      try {
        const groups = await searchGroups(q);
        return reply.send(groups);
      } catch (error) {
        fastify.log.error(error);
        return reply
          .status(502)
          .send({ error: error instanceof Error ? error.message : 'Gruppe-søk feilet.' });
      }
    },
  );

  // GET /api/graph/search/brukere?q=
  fastify.get<{ Querystring: { q?: string } }>(
    '/api/graph/search/brukere',
    async (request, reply) => {
      const q = request.query.q?.trim() ?? '';
      if (!q) return reply.send([]);
      try {
        const users = await searchUsers(q);
        return reply.send(users);
      } catch (error) {
        fastify.log.error(error);
        return reply
          .status(502)
          .send({ error: error instanceof Error ? error.message : 'Bruker-søk feilet.' });
      }
    },
  );

  // GET /api/workspaces/:id/tilgang
  fastify.get<{ Params: { id: string } }>(
    '/api/workspaces/:id/tilgang',
    async (request, reply) => {
      try {
        const workspace = await prisma.workspace.findUnique({
          where: { id: request.params.id },
          select: { id: true },
        });
        if (!workspace) return reply.status(404).send({ error: 'Workspace ikke funnet.' });

        const tilganger = await prisma.tilgang.findMany({
          where: { workspaceId: request.params.id },
          orderBy: { lagtTilDato: 'desc' },
        });
        return reply.send(tilganger);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke hente tilganger.' });
      }
    },
  );

  // POST /api/workspaces/:id/tilgang
  fastify.post<{ Params: { id: string }; Body: CreateTilgangBody }>(
    '/api/workspaces/:id/tilgang',
    {
      schema: {
        body: {
          type: 'object',
          required: ['type', 'entraId', 'visningsnavn', 'rolle'],
          properties: {
            type:         { type: 'string', minLength: 1 },
            entraId:      { type: 'string', minLength: 1 },
            visningsnavn: { type: 'string', minLength: 1 },
            epost:        { type: 'string' },
            rolle:        { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const workspace = await prisma.workspace.findUnique({
          where: { id: request.params.id },
          select: { id: true },
        });
        if (!workspace) return reply.status(404).send({ error: 'Workspace ikke funnet.' });

        // Duplikat-sjekk
        const existing = await prisma.tilgang.findFirst({
          where: { workspaceId: request.params.id, entraId: request.body.entraId },
          select: { id: true },
        });
        if (existing) {
          return reply
            .status(409)
            .send({ error: 'Denne gruppen/brukeren har allerede tilgang til dette workspacet.' });
        }

        const tilgang = await prisma.tilgang.create({
          data: { ...request.body, workspaceId: request.params.id },
        });
        return reply.status(201).send(tilgang);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke legge til tilgang.' });
      }
    },
  );

  // DELETE /api/workspaces/:id/tilgang/:tilgangId
  fastify.delete<{ Params: { id: string; tilgangId: string } }>(
    '/api/workspaces/:id/tilgang/:tilgangId',
    async (request, reply) => {
      try {
        await prisma.tilgang.delete({
          where: { id: request.params.tilgangId, workspaceId: request.params.id },
        });
        return reply.status(204).send();
      } catch (error) {
        if (isNotFound(error)) return reply.status(404).send({ error: 'Tilgang ikke funnet.' });
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke fjerne tilgang.' });
      }
    },
  );
}
