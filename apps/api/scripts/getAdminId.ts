import 'dotenv/config';
import * as sql from 'mssql';

const raw = process.env.DATABASE_URL ?? '';
const withoutProtocol = raw.replace('sqlserver://', '');
const [hostPort, ...paramParts] = withoutProtocol.split(';');
const [host, portStr] = hostPort.split(':');
const params: Record<string, string> = {};
paramParts.forEach(part => {
  const [key, ...rest] = part.split('=');
  if (key && rest.length) params[key.toLowerCase()] = rest.join('=');
});

const config: sql.config = {
  server: host,
  port: portStr ? parseInt(portStr) : 1433,
  database: params['database'] || params['initial catalog'],
  user: params['user'] || params['user id'],
  password: params['password'] || params['pwd'],
  options: { encrypt: true, trustServerCertificate: false },
};

const pool = await sql.connect(config);
const result = await pool.request().query(
  "SELECT TOP 3 entraObjectId, displayName, rolle FROM Bruker WHERE rolle = 'admin' AND erAktiv = 1",
);
console.log('Admin-brukere:', JSON.stringify(result.recordset, null, 2));
await pool.close();
