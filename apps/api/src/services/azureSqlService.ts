import * as sql from 'mssql';
import { parsePrismaUrl } from '../lib/tenantPrisma';
import { logger } from '../lib/logger';

let pool: sql.ConnectionPool | null = null;

// Én cachet pool per tenant-DB (databaseUrl). Analogt til clientCache i
// tenantPrisma.ts — hindrer at hver query åpner ny tilkobling.
const tenantPools = new Map<string, sql.ConnectionPool>();

// Maskerer DB-navn for logging (ikke lekk fullt navn til konsoll/logg).
const maskDb = (databaseUrl: string): string => {
  try {
    const db = parsePrismaUrl(databaseUrl).database ?? '';
    if (db.length <= 4) return '****';
    return `${db.slice(0, 2)}${'*'.repeat(db.length - 3)}${db.slice(-1)}`;
  } catch {
    return '****';
  }
};

const parseConnectionString = (connStr: string): sql.config => {
  // Håndter sqlserver:// format
  if (connStr.startsWith('sqlserver://')) {
    const withoutProtocol = connStr.replace('sqlserver://', '');
    const [hostPort, ...paramParts] = withoutProtocol.split(';');
    const [host, port] = hostPort.split(':');

    const params: Record<string, string> = {};
    paramParts.forEach((part) => {
      const [key, ...rest] = part.split('=');
      if (key && rest.length) params[key.toLowerCase()] = rest.join('=');
    });

    return {
      server: host,
      port: port ? parseInt(port) : 1433,
      database: params['database'] || params['initial catalog'],
      user: params['user'] || params['user id'] || params['uid'],
      password: params['password'] || params['pwd'],
      options: {
        encrypt: true,
        trustServerCertificate: false,
      },
    };
  }

  // Fallback: ADO.NET format (Server=...;Database=...;)
  const parts: Record<string, string> = {};
  connStr.split(';').forEach((part) => {
    const [key, ...rest] = part.split('=');
    if (key && rest.length) parts[key.trim().toLowerCase()] = rest.join('=').trim();
  });

  const server = (parts['server'] || parts['data source'] || '')
    .replace('tcp:', '')
    .split(',')[0];

  return {
    server,
    database: parts['database'] || parts['initial catalog'],
    user: parts['user id'] || parts['uid'],
    password: parts['password'] || parts['pwd'],
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
  };
};

const getPool = async (): Promise<sql.ConnectionPool> => {
  if (!pool) {
    const raw = process.env.DATABASE_URL ?? '';
    logger.debug('[AzureSQL] DATABASE_URL:', raw.substring(0, 80));
    const config = parseConnectionString(raw);
    logger.debug('[AzureSQL] Parsed config:', {
      server:      config.server,
      database:    config.database,
      user:        config.user,
      hasPassword: !!config.password,
    });
    pool = await sql.connect(config);
    logger.debug('[AzureSQL] Tilkobling OK');
  }
  return pool;
};

export const queryAzureSQL = async (
  sqlQuery: string,
  paramsOrMaxRows?: Record<string, string | number | boolean | null> | number,
  maxRows = 1000,
): Promise<Record<string, unknown>[]> => {
  const p = await getPool();
  const req = p.request();
  let limit = maxRows;
  if (typeof paramsOrMaxRows === 'number') {
    limit = paramsOrMaxRows;
  } else if (paramsOrMaxRows) {
    for (const [key, val] of Object.entries(paramsOrMaxRows)) {
      req.input(key, val);
    }
  }
  const result = await req.query(sqlQuery);
  return ((result.recordset as Record<string, unknown>[]) ?? []).slice(0, limit);
};

/**
 * Som queryAzureSQL, men kobler til en spesifikk tenant-DB via dens
 * databaseUrl (fra Tenant.databaseUrl). Pool caches per databaseUrl slik
 * at gjentatte kall mot samme tenant gjenbruker tilkoblingen.
 */
export const queryAzureSQLForTenant = async (
  databaseUrl: string,
  sqlQuery: string,
  params?: Record<string, any>,
  maxRows = 1000,
): Promise<any[]> => {
  let p = tenantPools.get(databaseUrl);
  if (!p) {
    // NB: new ConnectionPool — ikke sql.connect(). sql.connect() deler én
    // global pool i mssql; gjentatte kall med ulik config returnerer den
    // første tilkoblingen, noe som ville brutt tenant-isolasjon.
    p = await new sql.ConnectionPool(parsePrismaUrl(databaseUrl)).connect();
    tenantPools.set(databaseUrl, p);
    logger.debug(`[AzureSQL] Ny tenant-pool opprettet: ${maskDb(databaseUrl)}`);
  }
  const req = p.request();
  if (params) {
    for (const [key, val] of Object.entries(params)) {
      req.input(key, val);
    }
  }
  const result = await req.query(sqlQuery);
  return ((result.recordset as any[]) ?? []).slice(0, maxRows);
};

export const executeAzureSQL = async (sqlQuery: string): Promise<number> => {
  const p = await getPool();
  const result = await p.request().query(sqlQuery);
  return result.rowsAffected?.[0] ?? 0;
};
