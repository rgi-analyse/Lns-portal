import * as sql from 'mssql';

let pool: sql.ConnectionPool | null = null;

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
    console.log('[AzureSQL] DATABASE_URL:', raw.substring(0, 80));
    const config = parseConnectionString(raw);
    console.log('[AzureSQL] Parsed config:', {
      server:      config.server,
      database:    config.database,
      user:        config.user,
      hasPassword: !!config.password,
    });
    pool = await sql.connect(config);
    console.log('[AzureSQL] Tilkobling OK');
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

export const executeAzureSQL = async (sqlQuery: string): Promise<number> => {
  const p = await getPool();
  const result = await p.request().query(sqlQuery);
  return result.rowsAffected?.[0] ?? 0;
};
