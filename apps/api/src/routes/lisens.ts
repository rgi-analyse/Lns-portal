import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireBruker, type AuthRequest } from '../middleware/auth';

const STANDARD_SVAR = {
  lisens:                 'standard',
  maxBrukere:             50,
  lisensUtløper:          null,
  chatAktivert:           true,
  designerAktivert:       true,
  kombinertChartAktivert: true,
  personalAiAktivert:     false,
  eksportAktivert:        true,
  erUtløpt:               false,
};

const LISENS_SELECT = {
  lisens:                 true,
  maxBrukere:             true,
  lisensUtløper:          true,
  chatAktivert:           true,
  designerAktivert:       true,
  kombinertChartAktivert: true,
  personalAiAktivert:     true,
  eksportAktivert:        true,
  navn:                   true,
} as const;

function erUtløpt(utløper: Date | null): boolean {
  return utløper ? new Date(utløper) < new Date() : false;
}

interface LisensBody {
  lisens?:                 string;
  maxBrukere?:             number;
  lisensUtløper?:          string | null;
  chatAktivert?:           boolean;
  designerAktivert?:       boolean;
  kombinertChartAktivert?: boolean;
  personalAiAktivert?:     boolean;
  eksportAktivert?:        boolean;
}

export async function lisensRoutes(fastify: FastifyInstance) {
  // GET /api/lisens — åpent, brukes av portal ved oppstart
  fastify.get('/api/lisens', async (request, reply) => {
    const slug = (request.headers['x-tenant-id'] as string | undefined)?.toLowerCase() ?? 'lns';
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { slug },
        select: LISENS_SELECT,
      });
      if (!tenant) return reply.send(STANDARD_SVAR);
      return reply.send({ ...tenant, erUtløpt: erUtløpt(tenant.lisensUtløper) });
    } catch (err) {
      fastify.log.error(err);
      return reply.send(STANDARD_SVAR);
    }
  });

  // GET /api/admin/lisens — full lisensinfo for admin-panel
  fastify.get(
    '/api/admin/lisens',
    { preHandler: [requireBruker] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      if (!['tenantadmin', 'admin'].includes(bruker.rolle)) {
        return reply.status(403).send({ error: 'Ingen tilgang.' });
      }
      const slug = (request.headers['x-tenant-id'] as string | undefined)?.toLowerCase() ?? 'lns';
      try {
        const tenant = await prisma.tenant.findUnique({
          where: { slug },
          select: {
            id:      true,
            slug:    true,
            erAktiv: true,
            ...LISENS_SELECT,
          },
        });
        if (!tenant) return reply.status(404).send({ error: 'Tenant ikke funnet.' });
        const antallBrukere = await prisma.bruker.count({ where: { erAktiv: true } });
        return reply.send({ ...tenant, antallBrukere, erUtløpt: erUtløpt(tenant.lisensUtløper) });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Kunne ikke hente lisensinfo.' });
      }
    },
  );

  // PATCH /api/admin/lisens — kun tenantadmin
  fastify.patch<{ Body: LisensBody }>(
    '/api/admin/lisens',
    {
      preHandler: [requireBruker, async (req, rep) => {
        const b = (req as AuthRequest).bruker;
        if (!b || b.rolle !== 'tenantadmin') {
          return rep.status(403).send({ error: 'Kun tenantadmin kan endre lisens.' });
        }
      }],
      schema: {
        body: {
          type: 'object',
          properties: {
            lisens:                 { type: 'string', enum: ['basis', 'standard', 'premium'] },
            maxBrukere:             { type: 'number', minimum: 1 },
            lisensUtløper:          { type: ['string', 'null'] },
            chatAktivert:           { type: 'boolean' },
            designerAktivert:       { type: 'boolean' },
            kombinertChartAktivert: { type: 'boolean' },
            personalAiAktivert:     { type: 'boolean' },
            eksportAktivert:        { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const slug = (request.headers['x-tenant-id'] as string | undefined)?.toLowerCase() ?? 'lns';
      try {
        const data: Record<string, unknown> = { ...request.body };
        if (typeof data.lisensUtløper === 'string' && data.lisensUtløper) {
          data.lisensUtløper = new Date(data.lisensUtløper);
        } else if (data.lisensUtløper === null || data.lisensUtløper === '') {
          data.lisensUtløper = null;
        }
        const tenant = await prisma.tenant.update({ where: { slug }, data });
        const { databaseUrl: _db, ...safe } = tenant;
        return reply.send({ ...safe, erUtløpt: erUtløpt(tenant.lisensUtløper) });
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2025') {
          return reply.status(404).send({ error: 'Tenant ikke funnet.' });
        }
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Kunne ikke oppdatere lisens.' });
      }
    },
  );
}
