import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { feilRespons } from '../lib/feilRespons';
import { erIkkeFunnet } from '../lib/prismaFeil';
import { resolveTenant, resolveTenantAdmin, type TenantRequest } from '../middleware/tenant';
import { requireBruker, requireAdmin, erAdmin, type AuthRequest } from '../middleware/auth';
import { harWorkspaceTilgang } from '../services/sensorTilgang';

// ── Konfig-validering (zod) ─────────────────────────────────────────────────
const FARGER = ['primary', 'accent', 'success', 'warning', 'danger'] as const;

const GrafSchema = z.object({
  sensorId: z.string().min(1),
  tittel:   z.string().min(1).max(200),
  yMin:     z.number().nullable().optional(),
  yMax:     z.number().nullable().optional(),
  farge:    z.enum(FARGER),
});

const KonfigSchema = z.object({
  layout:        z.literal('vertikal'),           // kun vertikal for MVP
  grafer:        z.array(GrafSchema).min(1).max(6),
  visSensorNavn: z.boolean(),
  visSisteVerdi: z.boolean(),
});

const DashbordSchema = z.object({
  navn:                     z.string().min(1).max(200),
  workspaceId:              z.string().min(1),
  tidsvinduMinutter:        z.number().int().min(1).max(1440),
  oppdateringsIntervallSek: z.number().int().min(2).max(60),
  konfig:                   KonfigSchema,
});
type DashbordData = z.infer<typeof DashbordSchema>;

type Validering =
  | { ok: true; data: DashbordData }
  | { ok: false; status: number; error: string; detaljer?: string[] };

interface TenantDb {
  workspace: { findUnique: (a: unknown) => Promise<{ id: string } | null> };
  workspaceSensor: { findMany: (a: unknown) => Promise<{ sensorId: string }[]> };
}

async function valider(body: unknown, db: TenantDb): Promise<Validering> {
  const parsed = DashbordSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: 'Ugyldig dashbord-konfig.', detaljer: parsed.error.issues.map(i => `${i.path.join('.') || '(rot)'}: ${i.message}`) };
  }
  const { workspaceId, konfig } = parsed.data;

  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!ws) return { ok: false, status: 400, error: 'Ukjent workspaceId.' };

  // Alle graf-sensorer må være koblet til workspacet.
  const koblede = await db.workspaceSensor.findMany({ where: { workspaceId }, select: { sensorId: true } });
  const kobledeSet = new Set(koblede.map(k => k.sensorId));
  const utenfor = [...new Set(konfig.grafer.map(g => g.sensorId).filter(sid => !kobledeSet.has(sid)))];
  if (utenfor.length > 0) {
    return { ok: false, status: 400, error: `Sensor(er) ikke koblet til workspacet: ${utenfor.join(', ')}` };
  }
  return { ok: true, data: parsed.data };
}

function hentGrupper(request: FastifyRequest): string[] {
  const q = (request.query as { grupper?: string } | undefined)?.grupper;
  return typeof q === 'string' && q.trim() ? q.split(',').map(s => s.trim()).filter(Boolean) : [];
}

export async function sensorDashbordRoutes(fastify: FastifyInstance) {
  // ── GET /api/sensor-dashbord?workspaceId= — liste (uten konfig) ───────────
  fastify.get<{ Querystring: { workspaceId?: string; grupper?: string } }>(
    '/api/sensor-dashbord',
    { preHandler: [resolveTenant, requireBruker] },
    async (request, reply) => {
      const workspaceId = request.query.workspaceId;
      if (!workspaceId) return reply.status(400).send({ error: 'workspaceId er påkrevd.' });
      const bruker = (request as AuthRequest).bruker;
      const db = (request as TenantRequest).tenantPrisma;
      const tilgang = await harWorkspaceTilgang(
        { erAdminTilgang: erAdmin(bruker?.rolle), entraObjectId: bruker?.entraObjectId, grupper: hentGrupper(request), tenantPrisma: db },
        workspaceId,
      );
      if (!tilgang) return reply.status(403).send({ error: 'Du har ikke tilgang til dette workspacet.' });
      try {
        const dashbord = await db.sensorDashbord.findMany({
          where: { workspaceId },
          select: { id: true, navn: true, tidsvinduMinutter: true, oppdateringsIntervallSek: true, opprettet: true },
          orderBy: { navn: 'asc' },
        });
        return reply.send(dashbord);
      } catch (err) {
        return feilRespons(reply, 500, 'Kunne ikke hente dashbord.', err);
      }
    },
  );

  // ── GET /api/sensor-dashbord/:id — full konfig ────────────────────────────
  fastify.get<{ Params: { id: string }; Querystring: { grupper?: string } }>(
    '/api/sensor-dashbord/:id',
    { preHandler: [resolveTenant, requireBruker] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const db = (request as TenantRequest).tenantPrisma;
      let dashbord;
      try {
        dashbord = await db.sensorDashbord.findUnique({
          where: { id: request.params.id },
          select: { id: true, navn: true, workspaceId: true, tidsvinduMinutter: true, oppdateringsIntervallSek: true, konfig: true, opprettet: true },
        });
      } catch (err) {
        return feilRespons(reply, 500, 'Kunne ikke hente dashbord.', err);
      }
      if (!dashbord) return reply.status(404).send({ error: 'Dashbord ikke funnet.' });

      const tilgang = await harWorkspaceTilgang(
        { erAdminTilgang: erAdmin(bruker?.rolle), entraObjectId: bruker?.entraObjectId, grupper: hentGrupper(request), tenantPrisma: db },
        dashbord.workspaceId,
      );
      if (!tilgang) return reply.status(403).send({ error: 'Du har ikke tilgang til dette dashbordet.' });

      let konfig: unknown = null;
      try { konfig = JSON.parse(dashbord.konfig); } catch { /* korrupt JSON → null */ }
      return reply.send({ ...dashbord, konfig });
    },
  );

  // ── POST /api/admin/sensor-dashbord — opprett ─────────────────────────────
  fastify.post(
    '/api/admin/sensor-dashbord',
    { preHandler: [resolveTenantAdmin, requireBruker, requireAdmin] },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const v = await valider(request.body, db as unknown as TenantDb);
      if (!v.ok) return reply.status(v.status).send({ error: v.error, ...(v.detaljer ? { detaljer: v.detaljer } : {}) });
      const { navn, workspaceId, tidsvinduMinutter, oppdateringsIntervallSek, konfig } = v.data;
      try {
        const d = await db.sensorDashbord.create({
          data: { navn, workspaceId, tidsvinduMinutter, oppdateringsIntervallSek, konfig: JSON.stringify(konfig) },
          select: { id: true },
        });
        logger.warn('[sensor-dashbord] opprettet:', d.id, navn);
        return reply.status(201).send({ id: d.id });
      } catch (err) {
        return feilRespons(reply, 500, 'Kunne ikke opprette dashbord.', err);
      }
    },
  );

  // ── PUT /api/admin/sensor-dashbord/:id — oppdater (full replace) ───────────
  fastify.put<{ Params: { id: string } }>(
    '/api/admin/sensor-dashbord/:id',
    { preHandler: [resolveTenantAdmin, requireBruker, requireAdmin] },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      const v = await valider(request.body, db as unknown as TenantDb);
      if (!v.ok) return reply.status(v.status).send({ error: v.error, ...(v.detaljer ? { detaljer: v.detaljer } : {}) });

      const eksisterende = await db.sensorDashbord.findUnique({ where: { id: request.params.id }, select: { id: true } });
      if (!eksisterende) return reply.status(404).send({ error: 'Dashbord ikke funnet.' });

      const { navn, workspaceId, tidsvinduMinutter, oppdateringsIntervallSek, konfig } = v.data;
      try {
        await db.sensorDashbord.update({
          where: { id: request.params.id },
          data: { navn, workspaceId, tidsvinduMinutter, oppdateringsIntervallSek, konfig: JSON.stringify(konfig) },
        });
        return reply.status(200).send({ id: request.params.id });
      } catch (err) {
        if (erIkkeFunnet(err)) return reply.status(404).send({ error: 'Dashbord ikke funnet.' });
        return feilRespons(reply, 500, 'Kunne ikke oppdatere dashbord.', err);
      }
    },
  );

  // ── DELETE /api/admin/sensor-dashbord/:id ─────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/api/admin/sensor-dashbord/:id',
    { preHandler: [resolveTenantAdmin, requireBruker, requireAdmin] },
    async (request, reply) => {
      const db = (request as TenantRequest).tenantPrisma;
      try {
        await db.sensorDashbord.delete({ where: { id: request.params.id } });
        return reply.status(204).send();
      } catch (err) {
        if (erIkkeFunnet(err)) return reply.status(404).send({ error: 'Dashbord ikke funnet.' });
        return feilRespons(reply, 500, 'Kunne ikke slette dashbord.', err);
      }
    },
  );
}
