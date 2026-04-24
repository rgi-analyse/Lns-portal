import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import Ajv, { type ValidateFunction } from 'ajv';
import { prisma } from '../lib/prisma';
import { requireBruker, requireAnalyseTilgang, type AuthRequest } from '../middleware/auth';

// Ajv-instans deles mellom requests — cache compilerte validatorer per analyseTypeId
const ajv = new Ajv({ allErrors: true, strict: false });
const validatorCache = new Map<string, ValidateFunction>();

function kompilerValidator(analyseTypeId: string, rawSchema: string): ValidateFunction | null {
  const cached = validatorCache.get(analyseTypeId);
  if (cached) return cached;
  try {
    const schema = JSON.parse(rawSchema);
    const validator = ajv.compile(schema);
    validatorCache.set(analyseTypeId, validator);
    return validator;
  } catch {
    return null;
  }
}

function hentTenantSlug(request: { headers: Record<string, unknown> }): string {
  const slug = (request.headers['x-tenant-id'] as string | undefined)?.trim().toLowerCase();
  return slug || 'lns';
}

interface OpprettBody {
  analyseTypeId: string;
  parametre:     Record<string, unknown>;
  tittel?:       string;
}

export async function analyseRoutes(fastify: FastifyInstance) {

  // ── GET /api/analyse/typer ───────────────────────────────────────────────
  fastify.get(
    '/api/analyse/typer',
    { preHandler: [requireBruker, requireAnalyseTilgang] },
    async (_request, reply) => {
      const typer = await prisma.analyseType.findMany({
        where:  { erAktiv: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          navn: true,
          beskrivelse: true,
          ikon: true,
          parametreSchema: true,
        },
      });
      // parametreSchema lagres som JSON-tekst — parse for klienten
      const utData = typer.map(t => ({
        ...t,
        parametreSchema: safeParse(t.parametreSchema),
      }));
      return reply.send(utData);
    },
  );

  // ── GET /api/analyse/bestillinger ────────────────────────────────────────
  fastify.get(
    '/api/analyse/bestillinger',
    { preHandler: [requireBruker, requireAnalyseTilgang] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const tenantSlug = hentTenantSlug(request);

      const bestillinger = await prisma.analyseBestilling.findMany({
        where:   { brukerId: bruker.id, tenantSlug },
        orderBy: { bestiltDato: 'desc' },
        include: {
          analyseType: {
            select: { id: true, navn: true, ikon: true },
          },
        },
      });

      return reply.send(bestillinger.map(formaterBestilling));
    },
  );

  // ── GET /api/analyse/bestillinger/:id ────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/api/analyse/bestillinger/:id',
    { preHandler: [requireBruker, requireAnalyseTilgang] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const tenantSlug = hentTenantSlug(request);

      const bestilling = await prisma.analyseBestilling.findFirst({
        where: {
          id:         request.params.id,
          brukerId:   bruker.id,
          tenantSlug,
        },
        include: {
          analyseType: {
            select: { id: true, navn: true, ikon: true, beskrivelse: true },
          },
        },
      });

      if (!bestilling) {
        return reply.status(404).send({ error: 'Bestilling ikke funnet.' });
      }
      return reply.send(formaterBestilling(bestilling));
    },
  );

  // ── POST /api/analyse/bestillinger ───────────────────────────────────────
  fastify.post<{ Body: OpprettBody }>(
    '/api/analyse/bestillinger',
    {
      preHandler: [requireBruker, requireAnalyseTilgang],
      schema: {
        body: {
          type: 'object',
          required: ['analyseTypeId', 'parametre'],
          properties: {
            analyseTypeId: { type: 'string', minLength: 1 },
            parametre:     { type: 'object' },
            tittel:        { type: 'string', maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const tenantSlug = hentTenantSlug(request);
      const { analyseTypeId, parametre, tittel } = request.body;

      const type = await prisma.analyseType.findUnique({
        where:  { id: analyseTypeId },
        select: { id: true, erAktiv: true, parametreSchema: true, navn: true },
      });
      if (!type || !type.erAktiv) {
        return reply.status(400).send({ error: 'Ugyldig eller inaktiv analysetype.' });
      }

      const validator = kompilerValidator(type.id, type.parametreSchema);
      if (!validator) {
        fastify.log.error({ analyseTypeId: type.id }, '[analyse] ugyldig parametreSchema i DB');
        return reply.status(500).send({ error: 'Analysetypen har ugyldig parameter-schema.' });
      }
      if (!validator(parametre)) {
        return reply.status(400).send({
          error: 'Parametre matcher ikke analysetypens schema.',
          detaljer: validator.errors,
        });
      }

      // Sikre UserProfile-rad eksisterer (FK peker på UserProfile.userId)
      await prisma.userProfile.upsert({
        where:  { userId: bruker.id },
        update: {},
        create: { userId: bruker.id },
      });

      const id = crypto.randomUUID();
      const opprettet = await prisma.analyseBestilling.create({
        data: {
          id,
          brukerId:      bruker.id,
          tenantSlug,
          analyseTypeId: type.id,
          parametre:     JSON.stringify(parametre),
          status:        'BESTILT',
          tittel:        tittel?.trim() || null,
        },
        include: {
          analyseType: {
            select: { id: true, navn: true, ikon: true, beskrivelse: true },
          },
        },
      });

      return reply.status(201).send(formaterBestilling(opprettet));
    },
  );

  // ── DELETE /api/analyse/bestillinger/:id ─────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/api/analyse/bestillinger/:id',
    { preHandler: [requireBruker, requireAnalyseTilgang] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const tenantSlug = hentTenantSlug(request);

      const bestilling = await prisma.analyseBestilling.findFirst({
        where: { id: request.params.id, brukerId: bruker.id, tenantSlug },
        select: { id: true, status: true },
      });
      if (!bestilling) {
        return reply.status(404).send({ error: 'Bestilling ikke funnet.' });
      }
      if (bestilling.status !== 'BESTILT') {
        return reply.status(400).send({
          error: 'Kun bestillinger med status BESTILT kan kanselleres.',
          status: bestilling.status,
        });
      }

      const oppdatert = await prisma.analyseBestilling.update({
        where: { id: bestilling.id },
        data:  { status: 'KANSELLERT', ferdigDato: new Date() },
        include: {
          analyseType: {
            select: { id: true, navn: true, ikon: true },
          },
        },
      });
      return reply.send(formaterBestilling(oppdatert));
    },
  );
}

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

type BestillingMedType = {
  id: string;
  brukerId: string;
  tenantSlug: string;
  analyseTypeId: string;
  parametre: string;
  status: string;
  bestiltDato: Date;
  startetDato: Date | null;
  ferdigDato: Date | null;
  tittel: string | null;
  sammendrag: string | null;
  dokumentUrl: string | null;
  dokumentNavn: string | null;
  feilmelding: string | null;
  forsokAntall: number;
  tokenForbruk: number | null;
  modellBrukt: string | null;
  analyseType: { id: string; navn: string; ikon: string | null; beskrivelse?: string | null };
};

function formaterBestilling(b: BestillingMedType) {
  return {
    ...b,
    parametre: safeParse(b.parametre),
  };
}
