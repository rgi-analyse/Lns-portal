import type { FastifyInstance, FastifyRequest } from 'fastify';
import { logger } from '../lib/logger';
import { feilRespons } from '../lib/feilRespons';
import { erDuplikat } from '../lib/prismaFeil';
import { resolveTenant, resolveTenantAdmin, type TenantRequest } from '../middleware/tenant';
import { requireBruker, requireAdmin, erAdmin, type AuthRequest } from '../middleware/auth';
import { hentSensorTilgang, harTilgangTilSensor } from '../services/sensorTilgang';
import { velgSensorKilde, GYLDIGE_DATAKILDER } from '../services/sensorKilder';
import { verifiserTidskolonne } from '../services/azureSqlSensorService';
import type { SensorKonfig } from '../services/sensorDataKilde';

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
  // Valgfritt ?workspaceId= filtrerer til sensorer koblet til det workspacet
  // (brukes av dashbord-skjemaet for å vise kun relevante sensorer).
  fastify.get<{ Querystring: { workspaceId?: string; grupper?: string } }>(
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
        const wsFilter = request.query.workspaceId
          ? { workspaces: { some: { workspaceId: request.query.workspaceId } } }
          : {};
        const where = tilgang.mode === 'admin'
          ? { erAktiv: true, ...wsFilter }
          : { erAktiv: true, id: { in: [...tilgang.tillatteSensorIds] }, ...wsFilter };
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

      // Datakilde-konfig hentes fra DB (aldri fra URL) → lukker spoofing. Feltene
      // er de SensorKonfig trenger; dataKilde velger service under (etter tilgang).
      let sensor: SensorKonfig | null;
      try {
        sensor = await db.sensor.findFirst({
          where: { id, erAktiv: true },
          select: {
            sensorId: true, dataKilde: true,
            kqlTabell: true, kqlVerdiFelt: true,
            azureSqlTabell: true, azureSqlIdKolonne: true,
            azureSqlVerdiKolonne: true, azureSqlTidKolonne: true,
          },
        });
      } catch (err) {
        return feilRespons(reply, 500, 'Kunne ikke slå opp sensoren.', err);
      }
      if (!sensor) return reply.status(404).send({ error: 'Sensor ikke funnet.' });

      // Velg service på dataKilde. Fail-closed: ukjent kilde → henter ALDRI data.
      const kilde = velgSensorKilde(sensor.dataKilde);
      if (!kilde) {
        return feilRespons(reply, 500, 'Sensoren har en ukjent datakilde.',
          new Error(`ukjent dataKilde: ${sensor.dataKilde}`));
      }

      try {
        const punkter = await kilde.hentSerie(sensor, siden);
        return reply.send({ punkter });
      } catch (err) {
        return feilRespons(reply, 502, 'Kunne ikke hente sensor-data.', err);
      }
    },
  );

  // ── POST /api/admin/sensor — opprett sensor (admin) ───────────────────────
  // Støtter begge datakilder. kqlTabell/kqlVerdiFelt (kusto) og azureSql*-feltene
  // (azuresql) er valgfrie i schema; presens per datakilde håndheves av kildens
  // validerKonfig. For azuresql verifiseres tid-kolonnen mot lns-dwh FØR opprettelse
  // (fanger feilkonfig tidlig; evt. advarsel returneres til admin, ikke bare loggen).
  fastify.post<{
    Body: {
      navn: string; sensorId: string; dataKilde?: string;
      kqlTabell?: string; kqlVerdiFelt?: string;
      azureSqlTabell?: string; azureSqlIdKolonne?: string;
      azureSqlVerdiKolonne?: string; azureSqlTidKolonne?: string;
      enhet?: string; beskrivelse?: string;
    };
  }>(
    '/api/admin/sensor',
    {
      preHandler: [resolveTenantAdmin, requireBruker, requireAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['navn', 'sensorId'],
          properties: {
            navn:                 { type: 'string', minLength: 1, maxLength: 200 },
            sensorId:             { type: 'string', minLength: 1, maxLength: 100 },
            dataKilde:            { type: 'string', enum: GYLDIGE_DATAKILDER, default: 'kusto' },
            kqlTabell:            { type: 'string', minLength: 1, maxLength: 100 },
            kqlVerdiFelt:         { type: 'string', minLength: 1, maxLength: 100 },
            azureSqlTabell:       { type: 'string', minLength: 1, maxLength: 200 },
            azureSqlIdKolonne:    { type: 'string', minLength: 1, maxLength: 100 },
            azureSqlVerdiKolonne: { type: 'string', minLength: 1, maxLength: 100 },
            azureSqlTidKolonne:   { type: 'string', minLength: 1, maxLength: 100 },
            enhet:                { type: 'string', maxLength: 50 },
            beskrivelse:          { type: 'string', maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const b = request.body;
      const dataKilde = b.dataKilde ?? 'kusto';

      // Fail-closed: ukjent dataKilde → avvis (schema-enum fanger normalt dette).
      const kilde = velgSensorKilde(dataKilde);
      if (!kilde) return reply.status(400).send({ error: `Ukjent dataKilde: ${dataKilde}` });

      // Kun feltene relevant for kilden lagres; resten NULL. Én konfig valideres av
      // SAMME validerKonfig som hentSerie bruker (presens + strikt identifier-regex).
      const konfig: SensorKonfig = {
        sensorId:             b.sensorId,
        dataKilde,
        kqlTabell:            b.kqlTabell ?? null,
        kqlVerdiFelt:         b.kqlVerdiFelt ?? null,
        azureSqlTabell:       b.azureSqlTabell ?? null,
        azureSqlIdKolonne:    b.azureSqlIdKolonne ?? null,
        azureSqlVerdiKolonne: b.azureSqlVerdiKolonne ?? null,
        azureSqlTidKolonne:   b.azureSqlTidKolonne ?? null,
      };
      try {
        kilde.validerKonfig(konfig);
      } catch (e) {
        return reply.status(400).send({ error: e instanceof Error ? e.message : 'Ugyldig sensor-konfig.' });
      }

      // Azure SQL: verifiser tid-kolonnen mot ekte skjema før vi lagrer.
      //  - kolonne finnes ikke  → hard 400 (feilkonfig)
      //  - gammel `datetime`    → tillat, men returner advarsel til admin
      //  - kunne ikke verifisere → 502 (ikke lagre en usjekket sensor)
      let advarsel: string | undefined;
      if (dataKilde === 'azuresql') {
        try {
          const res = await verifiserTidskolonne(konfig);
          if (!res.ok) {
            return reply.status(400).send({ error: res.advarsel ?? 'Azure SQL-tidskolonne kunne ikke verifiseres.' });
          }
          advarsel = res.advarsel;
        } catch (err) {
          return feilRespons(reply, 502, 'Kunne ikke verifisere Azure SQL-tabell/-kolonne mot lns-dwh.', err);
        }
      }

      try {
        const db = (request as TenantRequest).tenantPrisma;
        const sensor = await db.sensor.create({
          data: {
            navn: b.navn, sensorId: b.sensorId, dataKilde,
            kqlTabell: konfig.kqlTabell, kqlVerdiFelt: konfig.kqlVerdiFelt,
            azureSqlTabell: konfig.azureSqlTabell, azureSqlIdKolonne: konfig.azureSqlIdKolonne,
            azureSqlVerdiKolonne: konfig.azureSqlVerdiKolonne, azureSqlTidKolonne: konfig.azureSqlTidKolonne,
            enhet: b.enhet ?? null, beskrivelse: b.beskrivelse ?? null,
          },
          select: {
            id: true, navn: true, sensorId: true, dataKilde: true,
            kqlTabell: true, kqlVerdiFelt: true,
            azureSqlTabell: true, azureSqlIdKolonne: true, azureSqlVerdiKolonne: true, azureSqlTidKolonne: true,
            enhet: true, beskrivelse: true, erAktiv: true,
          },
        });
        logger.warn('[sensor] opprettet sensor:', sensor.navn, sensor.sensorId, `(${dataKilde})`);
        return reply.status(201).send(advarsel ? { ...sensor, advarsel } : sensor);
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
