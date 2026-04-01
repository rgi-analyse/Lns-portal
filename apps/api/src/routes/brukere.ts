import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { getGraphToken } from '../services/graphService';
import { requireBruker, requireAdmin, resolveBruker, type AuthRequest } from '../middleware/auth';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GYLDIGE_ROLLER = ['tenantadmin', 'admin', 'redaktør', 'bruker'] as const;

interface GraphUserDetail {
  id: string;
  displayName: string;
  mail: string | null;
}

interface ImportBrukerEntry {
  entraObjectId: string;
  rolle?: string;
}

interface ImportBody {
  brukere: ImportBrukerEntry[];
}

interface PatchBody {
  erAktiv?: boolean;
  lisensType?: string;
  rolle?: string;
}

export async function brukerAdminRoutes(fastify: FastifyInstance) {
  // GET /api/me — returnerer pålogget brukers Bruker-record (ingen auth-krav, men 404 hvis ikke i DB)
  fastify.get('/api/me', async (request, reply) => {
    const bruker = await resolveBruker(request);
    if (!bruker) return reply.status(404).send({ error: 'Bruker ikke funnet.' });
    return reply.send(bruker);
  });

  // GET /api/admin/brukere?search=
  fastify.get<{ Querystring: { search?: string } }>(
    '/api/admin/brukere',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      try {
        const search = request.query.search?.trim();
        const brukere = await prisma.bruker.findMany({
          where: search
            ? {
                erAktiv: true,
                OR: [
                  { displayName: { contains: search } },
                  { email:       { contains: search } },
                ],
              }
            : undefined,
          orderBy: { displayName: 'asc' },
        });
        if (brukere.length > 0) {
          fastify.log.info('[brukere] rådata første bruker: %j', brukere[0]);
        }
        return reply.send(brukere);
      } catch (error) {
        fastify.log.error({ error }, '[brukere] FEIL');
        const msg = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // POST /api/admin/brukere/importer
  // Body: { brukere: [{entraObjectId: string, rolle?: string}] }
  fastify.post<{ Body: ImportBody }>(
    '/api/admin/brukere/importer',
    {
      preHandler: [requireBruker, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['brukere'],
          properties: {
            brukere: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['entraObjectId'],
                properties: {
                  entraObjectId: { type: 'string', minLength: 1 },
                  rolle: { type: 'string', enum: ['tenantadmin', 'admin', 'redaktør', 'bruker'] },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const token = await getGraphToken();
        const imported = [];

        for (const entry of request.body.brukere) {
          const rolle = GYLDIGE_ROLLER.includes(entry.rolle as typeof GYLDIGE_ROLLER[number])
            ? entry.rolle!
            : 'bruker';

          const res = await fetch(
            `${GRAPH_BASE}/users/${entry.entraObjectId}?$select=id,displayName,mail`,
            { headers: { Authorization: `Bearer ${token}` } },
          );

          if (!res.ok) {
            fastify.log.warn(`Graph /users/${entry.entraObjectId} svarte ${res.status}`);
            continue;
          }

          const user = await res.json() as GraphUserDetail;

          const bruker = await prisma.bruker.upsert({
            where: { entraObjectId: user.id },
            update: {
              displayName: user.displayName,
              email: user.mail ?? undefined,
              rolle,
            },
            create: {
              entraObjectId: user.id,
              displayName: user.displayName,
              email: user.mail ?? undefined,
              rolle,
            },
          });

          imported.push(bruker);
        }

        return reply.status(200).send(imported);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Importering feilet.' });
      }
    },
  );

  // PATCH /api/admin/brukere/:id
  fastify.patch<{ Params: { id: string }; Body: PatchBody }>(
    '/api/admin/brukere/:id',
    {
      preHandler: [requireBruker, requireAdmin],
      schema: {
        body: {
          type: 'object',
          properties: {
            erAktiv:   { type: 'boolean' },
            lisensType: { type: 'string' },
            rolle:     { type: 'string', enum: ['tenantadmin', 'admin', 'redaktør', 'bruker'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      fastify.log.info('[PATCH bruker] id=%s body=%j headers=%j', request.params.id, request.body, request.headers);
      const innloggetBruker = (request as AuthRequest).bruker;
      const nyRolle = request.body.rolle;

      // Kun tenantadmin kan tildele tenantadmin-rollen
      if (nyRolle === 'tenantadmin' && innloggetBruker.rolle !== 'tenantadmin') {
        return reply.status(403).send({ error: 'Kun tenantadmin kan tildele tenantadmin-rollen.' });
      }

      // Kun tenantadmin kan endre rollen til en eksisterende tenantadmin
      const målBruker = await prisma.bruker.findUnique({ where: { id: request.params.id } });
      if (målBruker?.rolle === 'tenantadmin' && innloggetBruker.rolle !== 'tenantadmin') {
        return reply.status(403).send({ error: 'Kun tenantadmin kan endre rollen til en tenantadmin.' });
      }

      try {
        const bruker = await prisma.bruker.update({
          where: { id: request.params.id },
          data: request.body,
        });
        return reply.send(bruker);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2025'
        ) {
          return reply.status(404).send({ error: 'Bruker ikke funnet.' });
        }
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke oppdatere bruker.' });
      }
    },
  );
}
