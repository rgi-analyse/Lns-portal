import 'dotenv/config';

// Startup-logging FØR noe annet lastes
console.log('[Startup] Node.js prosess startet');
console.log('[Startup] NODE_ENV:', process.env.NODE_ENV);
console.log('[Startup] PORT:', process.env.PORT);
console.log('[Startup] DATABASE_URL satt:', !!process.env.DATABASE_URL);
console.log('[Startup] PBI_TENANT_ID satt:', !!process.env.PBI_TENANT_ID);
console.log('[Startup] PBI_CLIENT_ID satt:', !!process.env.PBI_CLIENT_ID);
console.log('[Startup] PBI_CLIENT_SECRET satt:', !!process.env.PBI_CLIENT_SECRET);
console.log('[Startup] AZURE_OPENAI_KEY satt:', !!process.env.AZURE_OPENAI_KEY);

const påkrevde = ['DATABASE_URL', 'PBI_TENANT_ID', 'PBI_CLIENT_ID', 'PBI_CLIENT_SECRET'];
const mangler = påkrevde.filter(v => !process.env[v]);
if (mangler.length > 0) {
  console.warn('[Startup] ⚠️  MANGLENDE MILJØVARIABLER:', mangler.join(', '));
  console.warn('[Startup]    Legg til i Azure → App Service → Configuration → Application Settings');
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
import { temaRoutes } from './routes/tema';

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
        console.warn('[CORS] blokkert origin:', origin);
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
  await server.register(temaRoutes);

  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`API kjører på https://localhost:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
