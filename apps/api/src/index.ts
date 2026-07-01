import 'dotenv/config';
// Logger må importeres etter dotenv så NODE_ENV er populert før logger leser den.
import { logger } from './lib/logger';

// Startup-logging FØR noe annet lastes
logger.warn('[Startup] Node.js prosess startet');
logger.warn('[Startup] NODE_ENV:', process.env.NODE_ENV);
logger.warn('[Startup] PORT:', process.env.PORT);
logger.warn('[Startup] DATABASE_URL satt:', !!process.env.DATABASE_URL);
logger.warn('[Startup] PBI_TENANT_ID satt:', !!process.env.PBI_TENANT_ID);
logger.warn('[Startup] PBI_CLIENT_ID satt:', !!process.env.PBI_CLIENT_ID);
logger.warn('[Startup] PBI_CLIENT_SECRET satt:', !!process.env.PBI_CLIENT_SECRET);
logger.warn('[Startup] AZURE_OPENAI_KEY satt:', !!process.env.AZURE_OPENAI_KEY);
// KUSTO_* er valgfrie (kun sensor-modulen) — vises for synlighet, ikke i påkrevde-lista.
logger.warn('[Startup] KUSTO_CLUSTER_URI satt:', !!process.env.KUSTO_CLUSTER_URI);
logger.warn('[Startup] KUSTO_DATABASE satt:', !!process.env.KUSTO_DATABASE);

const påkrevde = ['DATABASE_URL', 'PBI_TENANT_ID', 'PBI_CLIENT_ID', 'PBI_CLIENT_SECRET'];
const mangler = påkrevde.filter(v => !process.env[v]);
if (mangler.length > 0) {
  logger.warn('[Startup] ⚠️  MANGLENDE MILJØVARIABLER:', mangler.join(', '));
  logger.warn('[Startup]    Legg til i Azure → App Service → Configuration → Application Settings');
}

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health';
import { embedTokenRoutes } from './routes/embedToken';
import { debugEnvRoutes } from './routes/debugEnv';
import { debugPbiRoutes } from './routes/debugPbi';
import { exportReportRoutes } from './routes/exportReport';
import { workspaceRoutes } from './routes/workspaces';
import { rapportRoutes } from './routes/rapporter';
import { tilgangRoutes } from './routes/tilgang';
import { pbiBrowserRoutes } from './routes/pbiBrowser';
import { debugTilgangRoutes } from './routes/debugTilgang';
import { rapportTilgangRoutes } from './routes/rapportTilgang';
import { brukerInnstillingerRoutes } from './routes/brukerInnstillinger';
import { chatRoutes } from './routes/chat';
import { tablesRoutes } from './routes/tables';
import { reportContextRoutes } from './routes/reportContext';
import { debugSchemasRoutes } from './routes/debugSchemas';
import { brukerAdminRoutes } from './routes/brukere';
import { metadataRoutes } from './routes/metadata';
import { authRoutes } from './routes/auth';
import { pbiRefreshRoutes } from './routes/pbiRefresh';
import { pbiCreateRoutes } from './routes/pbiCreate';
import { speechRoutes } from './routes/speech';
import { megInnstillingerRoutes } from './routes/megInnstillinger';
import { rapportDesignerRoutes } from './routes/rapportDesigner';
import { kpiRoutes } from './routes/kpi';
import { temaRoutes } from './routes/tema';
import { tenantRoutes } from './routes/tenants';
import { aktivitetRoutes } from './routes/aktivitet';
import { userEventRoutes } from './routes/userEvents';
import { lisensRoutes } from './routes/lisens';
import { analyseRoutes } from './routes/analyse';
import { slicerKatalogRoutes } from './routes/slicerKatalog';
import { adminSlicerIndeksRoutes } from './routes/adminSlicerIndeks';
import { sensorRoutes } from './routes/sensor';
import { sensorDashbordRoutes } from './routes/sensorDashbord';
import { startScheduler } from './services/slicerIndekseringScheduler';
import { startAnalyseWorker } from './workers/analyseWorker';

// Azure App Service håndterer TLS ved sin reverse-proxy – appen kjører alltid plain HTTP.
const server = Fastify({
  logger: process.env.NODE_ENV === 'production'
    ? true
    : { transport: { target: 'pino-pretty', options: { colorize: true } } },
  bodyLimit: 50 * 1024 * 1024,
});

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

async function start() {
  await server.register(cors, {
    origin: (origin, cb) => {
      const tillatte = [
        'http://localhost:3000',
        'https://localhost:3000',
        'https://10.0.1.132:3000',
        'https://lns-dataportal-portal.azurewebsites.net',
        process.env.CORS_ORIGIN,
      ].filter(Boolean) as string[];

      if (!origin || tillatte.includes(origin)) {
        cb(null, true);
      } else {
        logger.warn('[CORS] blokkert origin:', origin);
        cb(new Error('Ikke tillatt av CORS'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cookie',
      'x-entra-object-id',
      'x-entra-token',
      'x-user-id',
      'x-tenant-id',
    ],
    exposedHeaders: ['Set-Cookie'],
  });

  // Health check — alltid tilgjengelig uten auth, registreres først
  await server.register(healthRoutes);

  await server.register(embedTokenRoutes);
  await server.register(debugEnvRoutes);
  await server.register(debugPbiRoutes);
  await server.register(exportReportRoutes);
  await server.register(workspaceRoutes);
  await server.register(rapportRoutes);
  await server.register(tilgangRoutes);
  await server.register(pbiBrowserRoutes);
  await server.register(debugTilgangRoutes);
  await server.register(rapportTilgangRoutes);
  await server.register(brukerInnstillingerRoutes);
  await server.register(chatRoutes);
  await server.register(tablesRoutes);
  await server.register(reportContextRoutes);
  await server.register(debugSchemasRoutes);
  await server.register(brukerAdminRoutes);
  await server.register(metadataRoutes);
  await server.register(authRoutes);
  await server.register(pbiRefreshRoutes);
  await server.register(pbiCreateRoutes);
  await server.register(speechRoutes);
  await server.register(megInnstillingerRoutes);
  await server.register(rapportDesignerRoutes);
  await server.register(kpiRoutes);
  await server.register(temaRoutes);
  await server.register(tenantRoutes);
  await server.register(aktivitetRoutes);
  await server.register(userEventRoutes);
  await server.register(lisensRoutes);
  await server.register(analyseRoutes);
  await server.register(slicerKatalogRoutes);
  await server.register(adminSlicerIndeksRoutes);
  await server.register(sensorRoutes);
  await server.register(sensorDashbordRoutes);

  // Start scheduler etter at alt annet er klart, men før server.listen returnerer.
  // Skal ikke blokkere oppstart — funksjonen er fail-soft.
  startScheduler();

  const analyseWorkerEnabled =
    process.env.NODE_ENV !== 'test' &&
    process.env.SCHEDULER_ENABLED !== 'false';

  if (analyseWorkerEnabled) {
    startAnalyseWorker();
  }

  try {
    await server.listen({ port: PORT, host: HOST });
    logger.warn(`API kjører på https://localhost:${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
      // Logg admin-rutene ved oppstart for diagnostikk
      const linjer = server.printRoutes({ commonPrefix: false }).split('\n')
        .filter((l) => l.includes('/api/admin/'));
      if (linjer.length > 0) {
        logger.debug('\n[routes] /api/admin/*:');
        linjer.forEach((l) => logger.debug(`  ${l.trim()}`));
      }
    }
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
