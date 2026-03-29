import 'dotenv/config';

import fs from 'fs';
import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
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

const certPath = path.join(__dirname, '..');
const https = {
  key:  fs.readFileSync(path.join(certPath, '10.0.1.132+2-key.pem')),
  cert: fs.readFileSync(path.join(certPath, '10.0.1.132+2.pem')),
};

const server = Fastify({
  https,
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  },
  bodyLimit: 50 * 1024 * 1024, // 50MB
});

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

async function start() {
  await server.register(cors, {
    origin: [
      'http://localhost:3000',
      'https://localhost:3000',
      'https://10.0.1.132:3000',
    ],
    credentials: true,
  });

  // Health check - alltid tilgjengelig uten auth:
  server.get('/health', async (request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV ?? 'development',
      version: process.env.npm_package_version ?? '1.0.0',
      uptime: Math.floor(process.uptime())
    });
  });

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

  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`API kjører på https://localhost:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
