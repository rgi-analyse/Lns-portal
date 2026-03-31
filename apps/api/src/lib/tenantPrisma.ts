import { PrismaClient } from '../generated/prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';
import type { config as MssqlConfig } from 'mssql';

function parsePrismaUrl(url: string): MssqlConfig {
  const withoutProtocol = url.replace(/^sqlserver:\/\//, '');
  const parts = withoutProtocol.split(';');

  const [server, portStr] = parts[0].split(':');
  const port = portStr ? parseInt(portStr, 10) : 1433;

  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq !== -1) {
      params[part.slice(0, eq).toLowerCase()] = part.slice(eq + 1);
    }
  }

  return {
    server,
    port,
    database: params['database'],
    user: params['user'],
    password: params['password'],
    options: {
      encrypt: params['encrypt'] !== 'false',
      trustServerCertificate: params['trustservercertificate'] === 'true',
      connectTimeout: parseInt(params['connectiontimeout'] ?? '30', 10) * 1000,
    },
  };
}

const clientCache = new Map<string, PrismaClient>();

export function getPrismaForTenant(databaseUrl: string): PrismaClient {
  const cached = clientCache.get(databaseUrl);
  if (cached) return cached;
  const adapter = new PrismaMssql(parsePrismaUrl(databaseUrl));
  const client = new PrismaClient({ adapter });
  clientCache.set(databaseUrl, client);
  return client;
}
