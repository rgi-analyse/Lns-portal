import type { FastifyInstance, FastifyRequest } from 'fastify';
import { logger } from '../lib/logger';
import { feilRespons } from '../lib/feilRespons';
import { erDuplikat } from '../lib/prismaFeil';
import { resolveTenant, resolveTenantAdmin, type TenantRequest } from '../middleware/tenant';
import { requireBruker, requireAdmin, erAdmin, type AuthRequest } from '../middleware/auth';
import { hentSensorTilgang, harTilgangTilSensor } from '../services/sensorTilgang';
import { hentSensorData, erGyldigKqlIdent } from '../services/kustoService';

// Brukerens gruppe-OID-er (for gruppe-basert workspace-tilgang) sendes som
// ?grupper=oid1,oid2 fra frontend. Admin bruker uansett bypass.
function hentGrupper(request: FastifyRequest): string[] {
  const q = (request.query as { grupper?: string } | undefined)?.grupper;
  return typeof q === 'string' && q.trim()
    ? q.split(',').map(s => s.trim()).filter(Boolean)
    : [];
}

export async function sensorRoutes(fastify: FastifyInstance) {
  // ── GET /api/sensor — sensorer brukeren har tilgang til ────────────────────
  fastify.get(
    '/api/sensor',
    { preHandler: [resolveTenant, requireBruker] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const db = (request as TenantRequest).tenantPrisma;
      const tilgang = await hentSensorTilgang({
        erAdminTilgang: erAdmin(bruker?.rolle),
        entraObjectId: bruker?.entraObjectId,
        grupper: hentGrupper(request),
        tenantPrisma: db,
      });
      try {
        const where = tilgang.mode === 'admin'
          ? { erAktiv: true }
          : { erAktiv: true, id: { in: [...tilgang.tillatteSensorIds] } };
        const sensorer = await db.sensor.findMany({
          where,
          select: { id: true, navn: true, sensorId: true, enhet: true, beskrivelse: true },
          orderBy: { navn: 'asc' },
        });
        return reply.send(sensorer);
      } catch (err) {
        return feilRespons(reply, 500, 'Kunne ikke hente sensorer.', err);
      }
    },
  );

  // ── GET /api/sensor/:id/data?siden=<ISO> — tidsserie (delta-fetch) ─────────
  fastify.get<{ Params: { id: string }; Querystring: { siden?: string; grupper?: string } }>(
    '/api/sensor/:id/data',
    { preHandler: [resolveTenant, requireBruker] },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const db = (request as TenantRequest).tenantPrisma;
      const { id } = request.params;

      // Valider siden (ISO 8601). Default = siste 30 min.
      let siden: Date;
      if (request.query.siden !== undefined) {
        const d = new Date(request.query.siden);
        if (Number.isNaN(d.getTime())) {
          return reply.status(400).send({ error: 'Ugyldig siden-parameter (forventet ISO 8601-tidspunkt).' });
        }
        siden = d;
      } else {
        siden = new Date(Date.now() - 30 * 60 * 1000);
      }

      // Tilgangssjekk FØR oppslag/KQL — 403 lekker ikke om sensoren finnes.
      const tilgang = await hentSensorTilgang({
        erAdminTilgang: erAdmin(bruker?.rolle),
        entraObjectId: bruker?.entraObjectId,
        grupper: hentGrupper(request),
        tenantPrisma: db,
      });
      if (!harTilgangTilSensor(tilgang, id)) {
        return reply.status(403).send({ error: 'Du har ikke tilgang til denne sensoren.' });
      }

      // KQL-identifikatorer hentes fra DB (aldri fra URL) → lukker spoofing.
      let sensor: { sensorId: string; kqlTabell: string; kqlVerdiFelt: string } | null;
      try {
        sensor = await db.sensor.findFirst({
          where: { id, erAktiv: true },
          select: { sensorId: true, kqlTabell: true, kqlVerdiFelt: true },
        });
      } catch (err) {
        return feilRespons(reply, 500, 'Kunne ikke slå opp sensoren.', err);
      }
      if (!sensor) return reply.status(404).send({ error: 'Sensor ikke funnet.' });

      try {
        const punkter = await hentSensorData({
          kqlTabell: sensor.kqlTabell,
          kqlVerdiFelt: sensor.kqlVerdiFelt,
          kqlSensorId: sensor.sensorId,
          siden,
        });
        return reply.send({ punkter });
      } catch (err) {
        return feilRespons(reply, 502, 'Kunne ikke hente sensor-data.', err);
      }
    },
  );

  // ── POST /api/admin/sensor — opprett sensor (admin) ───────────────────────
  fastify.post<{ Body: { navn: string; sensorId: string; kqlTabell: string; kqlVerdiFelt: string; enhet?: string; beskrivelse?: string } }>(
    '/api/admin/sensor',
    {
      preHandler: [resolveTenantAdmin, requireBruker, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['navn', 'sensorId', 'kqlTabell', 'kqlVerdiFelt'],
          properties: {
            navn:         { type: 'string', minLength: 1, maxLength: 200 },
            sensorId:     { type: 'string', minLength: 1, maxLength: 100 },
            kqlTabell:    { type: 'string', minLength: 1, maxLength: 100 },
            kqlVerdiFelt: { type: 'string', minLength: 1, maxLength: 100 },
            enhet:        { type: 'string', maxLength: 50 },
            beskrivelse:  { type: 'string', maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { navn, sensorId, kqlTabell, kqlVerdiFelt, enhet, beskrivelse } = request.body;
      if (!erGyldigKqlIdent(kqlTabell) || !erGyldigKqlIdent(kqlVerdiFelt)) {
        return reply.status(400).send({ error: 'Ugyldig kqlTabell/kqlVerdiFelt (kun A-Z, 0-9 og _, maks 100 tegn).' });
      }
      try {
        const db = (request as TenantRequest).tenantPrisma;
        const sensor = await db.sensor.create({
          data: { navn, sensorId, kqlTabell, kqlVerdiFelt, enhet: enhet ?? null, beskrivelse: beskrivelse ?? null },
          select: { id: true, navn: true, sensorId: true, kqlTabell: true, kqlVerdiFelt: true, enhet: true, beskrivelse: true, erAktiv: true },
        });
        logger.warn('[sensor] opprettet sensor:', sensor.navn, sensor.sensorId);
        return reply.status(201).send(sensor);
      } catch (err) {
        if (erDuplikat(err)) {
          return reply.status(409).send({ error: 'En sensor med denne sensorId finnes allerede.' });
        }
        return feilRespons(reply, 500, 'Kunne ikke opprette sensor.', err);
      }
    },
  );

  // ── POST /api/admin/workspace-sensor — koble sensor til workspace (admin) ──
  // sensorId her = Sensor.id (Prisma-UUID fra POST /api/admin/sensor).
  fastify.post<{ Body: { workspaceId: string; sensorId: string } }>(
    '/api/admin/workspace-sensor',
    {
      preHandler: [resolveTenantAdmin, requireBruker, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['workspaceId', 'sensorId'],
          properties: {
            workspaceId: { type: 'string', minLength: 1 },
            sensorId:    { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, sensorId } = request.body;
      const db = (request as TenantRequest).tenantPrisma;
      try {
        const [ws, sensor] = await Promise.all([
          db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } }),
          db.sensor.findUnique({ where: { id: sensorId }, select: { id: true } }),
        ]);
        if (!ws) return reply.status(404).send({ error: 'Workspace ikke funnet.' });
        if (!sensor) return reply.status(404).send({ error: 'Sensor ikke funnet.' });

        await db.workspaceSensor.create({ data: { workspaceId, sensorId } });
        logger.warn('[sensor] koblet sensor', sensorId, 'til workspace', workspaceId);
        return reply.status(201).send({ workspaceId, sensorId });
      } catch (err) {
        if (erDuplikat(err)) {
          return reply.status(409).send({ error: 'Sensoren er allerede koblet til dette workspacet.' });
        }
        return feilRespons(reply, 500, 'Kunne ikke koble sensor til workspace.', err);
      }
    },
  );
}
