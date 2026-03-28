import * as mssql from 'mssql';
import { getAzureToken } from '../lib/azureToken';

const server   = process.env.FABRIC_SQL_SERVER   ?? '';
const database = process.env.FABRIC_SQL_DATABASE ?? '';
const tenantId = process.env.PBI_TENANT_ID       ?? '';
const clientId = process.env.PBI_CLIENT_ID       ?? '';
const clientSecret = process.env.PBI_CLIENT_SECRET ?? '';

console.log('[Fabric] Forsøker tilkobling til:', {
  server:   process.env.FABRIC_SQL_SERVER,
  database: process.env.FABRIC_SQL_DATABASE,
});

async function testConnection(): Promise<void> {
  try {
    const result = await executeQuery('SELECT TOP 5 TABLE_NAME FROM INFORMATION_SCHEMA.TABLES');
    console.log('[Fabric] Tilkobling OK, tabeller:', result);
  } catch (err) {
    console.error('[Fabric] Tilkobling feilet:', err instanceof Error ? err.message : err);
  }
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface TableInfo {
  fullName: string;
  schema: string;
  table: string;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

async function getPool(): Promise<mssql.ConnectionPool> {
  console.log('[Fabric] Henter Azure AD token med scope: https://database.windows.net/.default');
  const token = await getAzureToken(
    tenantId,
    clientId,
    clientSecret,
    'https://database.windows.net/.default',
  );
  console.log('[Fabric] Token hentet, lengde:', token.length);

  const config: mssql.config = {
    server,
    database,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token },
    },
  };
  console.log('[Fabric] Auth-metode: azure-active-directory-access-token');

  const pool = new mssql.ConnectionPool(config);
  await pool.connect();
  return pool;
}

function validateSelect(sql: string): void {
  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith('SELECT')) {
    throw new Error('Bare SELECT-spørringer er tillatt.');
  }
  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'EXEC', 'EXECUTE', '--', ';'];
  for (const keyword of forbidden) {
    if (normalized.includes(keyword)) {
      throw new Error(`Forbudt SQL-nøkkelord: ${keyword}`);
    }
  }
}

export async function executeQuery(sql: string, maxRows = 100): Promise<QueryResult> {
  validateSelect(sql);

  const pool = await getPool();
  try {
    const limited = `SELECT TOP ${maxRows} * FROM (${sql}) AS __q`;
    const result = await pool.request().query(limited);

    const columns = result.recordset.columns
      ? Object.keys(result.recordset.columns)
      : result.recordset.length > 0
        ? Object.keys(result.recordset[0])
        : [];

    return {
      columns,
      rows: result.recordset as Record<string, unknown>[],
    };
  } finally {
    await pool.close();
  }
}

export async function getTableSchema(tableName?: string): Promise<TableInfo[]> {
  const pool = await getPool();
  try {
    if (!tableName) {
      // List all tables in the gold schema with full schema-prefix
      const sql = `
        SELECT
          TABLE_SCHEMA + '.' + TABLE_NAME AS full_name,
          TABLE_NAME,
          TABLE_SCHEMA
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'gold'
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
      `;
      const result = await pool.request().query(sql);
      return (result.recordset as {
        full_name: string;
        TABLE_NAME: string;
        TABLE_SCHEMA: string;
      }[]).map((row) => ({
        fullName: row.full_name,
        schema:   row.TABLE_SCHEMA,
        table:    row.TABLE_NAME,
        columns:  [],
      }));
    }

    // Split "schema.table" if a dot is present
    const dotIndex = tableName.indexOf('.');
    const schemaName = dotIndex !== -1 ? tableName.slice(0, dotIndex)  : 'gold';
    const tableOnly  = dotIndex !== -1 ? tableName.slice(dotIndex + 1) : tableName;

    const sql = `
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schemaName
        AND TABLE_NAME   = @tableOnly
      ORDER BY ORDINAL_POSITION
    `;
    const result = await pool.request()
      .input('schemaName', mssql.VarChar, schemaName)
      .input('tableOnly',  mssql.VarChar, tableOnly)
      .query(sql);

    const columns = (result.recordset as {
      COLUMN_NAME: string;
      DATA_TYPE: string;
      IS_NULLABLE: string;
    }[]).map((row) => ({
      name:     row.COLUMN_NAME,
      type:     row.DATA_TYPE,
      nullable: row.IS_NULLABLE === 'YES',
    }));

    return [{
      fullName: `${schemaName}.${tableOnly}`,
      schema:   schemaName,
      table:    tableOnly,
      columns,
    }];
  } finally {
    await pool.close();
  }
}

testConnection();
