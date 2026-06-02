import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireBruker, requireAdmin } from '../middleware/auth';
import { extractSlug } from '../middleware/tenant';

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

// Felter som returneres fra GET /api/tema (åpent endepunkt) — tenantSlug
// utelates bevisst for bit-identitet med pre-migrasjons-respons.
const ÅPEN_TEMA_SELECT = {
  id:               true,
  organisasjonNavn: true,
  primaryColor:     true,
  backgroundColor:  true,
  navyColor:        true,
  accentColor:      true,
  textColor:        true,
  textMutedColor:   true,
  logoUrl:          true,
  oppdatert:        true,
  opprettet:        true,
} as const;

export async function temaRoutes(fastify: FastifyInstance) {
  // GET /api/tema — åpent, brukes av ThemeProvider ved oppstart.
  // Tenant utledes lokalt fordi ruten ligger i SKIP_TENANT_PATHS (vi trenger
  // ikke tenantPrisma — kun slug-en for å slå opp riktig rad i master-DB).
  fastify.get('/api/tema', async (request, reply) => {
    try {
      const slug = extractSlug(request);
      const tema = await prisma.organisasjonTema.findUnique({
        where:  { tenantSlug: slug },
        select: ÅPEN_TEMA_SELECT,
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

  // GET /api/admin/tema — kun current tenant (én rad eller tom).
  // Returnerer array for å beholde kontrakt med admin-UI.
  fastify.get(
    '/api/admin/tema',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const slug = extractSlug(request);
      const temaer = await prisma.organisasjonTema.findMany({
        where:   { tenantSlug: slug },
        orderBy: { organisasjonNavn: 'asc' },
      });
      return reply.send(temaer);
    },
  );

  // POST /api/admin/tema — opprett tema for current tenant.
  // tenantSlug settes alltid fra request (overstyrer body hvis sendt).
  fastify.post<{ Body: TemaBody }>(
    '/api/admin/tema',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const slug = extractSlug(request);
      try {
        const tema = await prisma.organisasjonTema.create({
          data: {
            ...(request.body as Parameters<typeof prisma.organisasjonTema.create>[0]['data']),
            tenantSlug: slug,
          },
        });
        return reply.status(201).send(tema);
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'P2002') {
          return reply.status(409).send({ error: 'Tenanten har allerede et tema.' });
        }
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Kunne ikke opprette tema.' });
      }
    },
  );

  // PATCH /api/admin/tema/:id — oppdater. Cross-tenant-vern: 403 hvis radens
  // tenantSlug ikke matcher current tenant.
  fastify.patch<{ Params: { id: string }; Body: TemaBody }>(
    '/api/admin/tema/:id',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const slug = extractSlug(request);
      try {
        const eksisterende = await prisma.organisasjonTema.findUnique({
          where:  { id: request.params.id },
          select: { tenantSlug: true },
        });
        if (!eksisterende) {
          return reply.status(404).send({ error: 'Tema ikke funnet.' });
        }
        if (eksisterende.tenantSlug !== slug) {
          return reply.status(403).send({ error: 'Tema tilhører annen tenant.' });
        }
        const tema = await prisma.organisasjonTema.update({
          where: { id: request.params.id },
          data:  request.body as Parameters<typeof prisma.organisasjonTema.update>[0]['data'],
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

  // DELETE /api/admin/tema/:id — slett. Samme cross-tenant-vern som PATCH.
  fastify.delete<{ Params: { id: string } }>(
    '/api/admin/tema/:id',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const slug = extractSlug(request);
      try {
        const eksisterende = await prisma.organisasjonTema.findUnique({
          where:  { id: request.params.id },
          select: { tenantSlug: true },
        });
        if (!eksisterende) {
          return reply.status(404).send({ error: 'Tema ikke funnet.' });
        }
        if (eksisterende.tenantSlug !== slug) {
          return reply.status(403).send({ error: 'Tema tilhører annen tenant.' });
        }
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
