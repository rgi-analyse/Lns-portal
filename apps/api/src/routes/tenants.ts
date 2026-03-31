import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireBruker, requireAdmin } from '../middleware/auth';

interface CreateTenantBody {
  slug: string;
  navn: string;
  databaseUrl: string;
}

interface UpdateTenantBody {
  navn?: string;
  databaseUrl?: string;
  erAktiv?: boolean;
}

export async function tenantRoutes(fastify: FastifyInstance) {
  // GET /api/admin/tenants
  fastify.get(
    '/api/admin/tenants',
    { preHandler: [requireBruker, requireAdmin] },
    async (_request, reply) => {
      try {
        const tenants = await prisma.tenant.findMany({
          select: { id: true, slug: true, navn: true, erAktiv: true, opprettet: true, oppdatert: true },
          orderBy: { opprettet: 'asc' },
        });
        return reply.send(tenants);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke hente tenants.' });
      }
    },
  );

  // POST /api/admin/tenants
  fastify.post<{ Body: CreateTenantBody }>(
    '/api/admin/tenants',
    {
      preHandler: [requireBruker, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['slug', 'navn', 'databaseUrl'],
          properties: {
            slug:        { type: 'string', minLength: 1 },
            navn:        { type: 'string', minLength: 1 },
            databaseUrl: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { slug, navn, databaseUrl } = request.body;
      try {
        const tenant = await prisma.tenant.create({
          data: { slug: slug.toLowerCase().trim(), navn, databaseUrl },
        });
        return reply.status(201).send({
          id: tenant.id, slug: tenant.slug, navn: tenant.navn,
          erAktiv: tenant.erAktiv, opprettet: tenant.opprettet,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke opprette tenant.' });
      }
    },
  );

  // PATCH /api/admin/tenants/:id
  fastify.patch<{ Params: { id: string }; Body: UpdateTenantBody }>(
    '/api/admin/tenants/:id',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { navn, databaseUrl, erAktiv } = request.body;
      try {
        const tenant = await prisma.tenant.update({
          where: { id: request.params.id },
          data: {
            ...(navn !== undefined && { navn }),
            ...(databaseUrl !== undefined && { databaseUrl }),
            ...(erAktiv !== undefined && { erAktiv }),
          },
        });
        return reply.send({
          id: tenant.id, slug: tenant.slug, navn: tenant.navn, erAktiv: tenant.erAktiv,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke oppdatere tenant.' });
      }
    },
  );

  // DELETE /api/admin/tenants/:id  (soft-delete)
  fastify.delete<{ Params: { id: string } }>(
    '/api/admin/tenants/:id',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      try {
        await prisma.tenant.update({
          where: { id: request.params.id },
          data: { erAktiv: false },
        });
        return reply.status(204).send();
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Kunne ikke deaktivere tenant.' });
      }
    },
  );
}
