import { PrismaClient } from '../generated/prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';
import type { config as MssqlConfig } from 'mssql';

/**
 * Konverterer Prisma sin SQL Server URL-format til mssql config-objekt.
 * Format: sqlserver://server:port;database=x;user=x;password=x;encrypt=true;...
 */
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

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL er ikke satt.');

  const adapter = new PrismaMssql(parsePrismaUrl(connectionString));
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
