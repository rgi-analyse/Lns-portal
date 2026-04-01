import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireBruker, type AuthRequest } from '../middleware/auth';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../services/passwordService';
import crypto from 'crypto';

interface LoginCheckBody  { email: string }
interface LoginLokalBody  { email: string; passord: string }
interface ByttPassordBody { gammeltPassord: string; nyttPassord: string }

interface LokalBrukerBody {
  email: string;
  displayName: string;
  passord: string;
  rolle?: string;
  måByttePassord?: boolean;
}

interface ResetPassordBody { nyttPassord: string }

const GYLDIGE_ROLLER = ['tenantadmin', 'admin', 'redaktør', 'bruker'] as const;

export async function authRoutes(fastify: FastifyInstance) {

  // ── POST /api/auth/login-check ─────────────────────────────────────────────
  // Sjekk om e-post finnes og om det er Entra- eller lokal bruker
  fastify.post<{ Body: LoginCheckBody }>(
    '/api/auth/login-check',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string', minLength: 1 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const email = request.body.email.trim().toLowerCase();
      try {
        const bruker = await prisma.bruker.findFirst({
          where: { email: { equals: email }, erAktiv: true },
          select: { erEntraBruker: true },
        });
        fastify.log.info('[login-check] bruker: %j', bruker);
        if (!bruker) return reply.send({ finnes: false });
        return reply.send({ finnes: true, erEntra: bruker.erEntraBruker });
      } catch (err) {
        fastify.log.error({ err }, "[login-check] FEIL");
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // ── POST /api/auth/login-lokal ─────────────────────────────────────────────
  // Logg inn med e-post + passord (kun lokale brukere)
  fastify.post<{ Body: LoginLokalBody }>(
    '/api/auth/login-lokal',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'passord'],
          properties: {
            email:   { type: 'string', minLength: 1 },
            passord: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const email = request.body.email.trim().toLowerCase();
      let bruker;
      try {
        bruker = await prisma.bruker.findFirst({
          where: { email: { equals: email }, erEntraBruker: false, erAktiv: true },
        });
      } catch (err) {
        fastify.log.error({ err }, "[login-lokal] findFirst FEIL");
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
      if (!bruker || !bruker.passordHash) {
        return reply.status(401).send({ error: 'Feil e-post eller passord.' });
      }
      const ok = await verifyPassword(request.body.passord, bruker.passordHash);
      if (!ok) {
        return reply.status(401).send({ error: 'Feil e-post eller passord.' });
      }
      await prisma.bruker.update({
        where: { id: bruker.id },
        data: { sistInnlogget: new Date() },
      });
      return reply.send({
        success: true,
        entraObjectId: bruker.entraObjectId,
        displayName:   bruker.displayName,
        email:         bruker.email,
        rolle:         bruker.rolle,
        måByttePassord: bruker.måByttePassord,
      });
    },
  );

  // ── POST /api/auth/bytt-passord ────────────────────────────────────────────
  // Bruker bytter eget passord (krever innlogging via X-Entra-Object-Id)
  fastify.post<{ Body: ByttPassordBody }>(
    '/api/auth/bytt-passord',
    {
      preHandler: [requireBruker],
      schema: {
        body: {
          type: 'object',
          required: ['gammeltPassord', 'nyttPassord'],
          properties: {
            gammeltPassord: { type: 'string', minLength: 1 },
            nyttPassord:    { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      if (bruker.erEntraBruker) {
        return reply.status(400).send({ error: 'Entra-brukere kan ikke bytte passord her.' });
      }
      if (!bruker.passordHash) {
        return reply.status(400).send({ error: 'Ingen passord er satt for denne brukeren.' });
      }
      const gammeltOk = await verifyPassword(request.body.gammeltPassord, bruker.passordHash);
      if (!gammeltOk) {
        return reply.status(401).send({ error: 'Feil nåværende passord.' });
      }
      const styrke = validatePasswordStrength(request.body.nyttPassord);
      if (!styrke.valid) {
        return reply.status(400).send({ error: styrke.message });
      }
      const hash = await hashPassword(request.body.nyttPassord);
      await prisma.bruker.update({
        where: { id: bruker.id },
        data: { passordHash: hash, måByttePassord: false, sistPassordEndret: new Date() },
      });
      return reply.send({ success: true });
    },
  );

  // ── POST /api/admin/brukere/lokal ──────────────────────────────────────────
  // Admin oppretter ny lokal bruker med passord
  fastify.post<{ Body: LokalBrukerBody }>(
    '/api/admin/brukere/lokal',
    {
      preHandler: [requireBruker, async (req, rep) => {
        const b = (req as AuthRequest).bruker;
        if (!b || !['admin', 'tenantadmin'].includes(b.rolle)) return rep.status(403).send({ error: 'Krever admin-tilgang.' });
      }],
      schema: {
        body: {
          type: 'object',
          required: ['email', 'displayName', 'passord'],
          properties: {
            email:          { type: 'string', minLength: 1 },
            displayName:    { type: 'string', minLength: 1 },
            passord:        { type: 'string', minLength: 1 },
            rolle:          { type: 'string', enum: ['tenantadmin', 'admin', 'redaktør', 'bruker'] },
            måByttePassord: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { email, displayName, passord, rolle, måByttePassord } = request.body;
      const normalEmail = email.trim().toLowerCase();

      const finnes = await prisma.bruker.findFirst({ where: { email: { equals: normalEmail } } });
      if (finnes) return reply.status(409).send({ error: 'E-postadressen er allerede i bruk.' });

      const styrke = validatePasswordStrength(passord);
      if (!styrke.valid) return reply.status(400).send({ error: styrke.message });

      const rolleVerifisert = GYLDIGE_ROLLER.includes(rolle as typeof GYLDIGE_ROLLER[number])
        ? (rolle as string)
        : 'bruker';

      let hash: string;
      let bruker;
      try {
        hash = await hashPassword(passord);
        bruker = await prisma.bruker.create({
          data: {
            entraObjectId:  crypto.randomUUID(),
            displayName:    displayName.trim(),
            email:          normalEmail,
            rolle:          rolleVerifisert,
            erEntraBruker:  false,
            passordHash:    hash,
            måByttePassord: måByttePassord ?? true,
            erAktiv:        true,
          },
        });
      } catch (err) {
        fastify.log.error({ err }, '[Admin] feil ved opprettelse av lokal bruker');
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
      return reply.status(201).send(bruker);
    },
  );

  // ── PUT /api/admin/brukere/:id/reset-passord ───────────────────────────────
  // Admin setter nytt passord for lokal bruker
  fastify.put<{ Params: { id: string }; Body: ResetPassordBody }>(
    '/api/admin/brukere/:id/reset-passord',
    {
      preHandler: [requireBruker, async (req, rep) => {
        const b = (req as AuthRequest).bruker;
        if (!b || !['admin', 'tenantadmin'].includes(b.rolle)) return rep.status(403).send({ error: 'Krever admin-tilgang.' });
      }],
      schema: {
        body: {
          type: 'object',
          required: ['nyttPassord'],
          properties: { nyttPassord: { type: 'string', minLength: 1 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const bruker = await prisma.bruker.findUnique({ where: { id: request.params.id } });
      if (!bruker) return reply.status(404).send({ error: 'Bruker ikke funnet.' });
      if (bruker.erEntraBruker) {
        return reply.status(400).send({ error: 'Kan ikke resette passord for Entra-bruker.' });
      }
      const styrke = validatePasswordStrength(request.body.nyttPassord);
      if (!styrke.valid) return reply.status(400).send({ error: styrke.message });

      const hash = await hashPassword(request.body.nyttPassord);
      const oppdatert = await prisma.bruker.update({
        where: { id: request.params.id },
        data: { passordHash: hash, måByttePassord: true, sistPassordEndret: new Date() },
      });
      return reply.send(oppdatert);
    },
  );
}
