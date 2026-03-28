import 'dotenv/config';
import * as sql from 'mssql';

const raw = process.env.DATABASE_URL ?? '';
const wp = raw.replace('sqlserver://', '');
const [hp, ...ps] = wp.split(';');
const [host, portStr] = hp.split(':');
const params: Record<string, string> = {};
ps.forEach(p => { const [k, ...r] = p.split('='); if (k && r.length) params[k.toLowerCase()] = r.join('='); });

const config: sql.config = {
  server: host, port: parseInt(portStr || '1433'),
  database: params['database'], user: params['user'],
  password: params['password'], options: { encrypt: true, trustServerCertificate: false },
};

async function main() {
  const pool = await sql.connect(config);

  const før = await pool.request().query(
    "SELECT id, navn, område FROM Rapport WHERE pbiReportId = 'ffd05808-dfd2-4465-a83f-474a51c757cf'",
  );
  console.log('Før:', JSON.stringify(før.recordset[0] ?? 'ikke funnet'));

  const upd = await pool.request().query(
    "UPDATE Rapport SET område = 'HMS' WHERE pbiReportId = 'ffd05808-dfd2-4465-a83f-474a51c757cf'",
  );
  console.log(`Oppdatert ${upd.rowsAffected[0]} rad(er)`);

  const etter = await pool.request().query(
    "SELECT id, navn, område FROM Rapport WHERE pbiReportId = 'ffd05808-dfd2-4465-a83f-474a51c757cf'",
  );
  console.log('Etter:', JSON.stringify(etter.recordset[0] ?? 'ikke funnet'));

  // Vis alle rapporter og deres område
  const alle = await pool.request().query(
    'SELECT navn, område, pbiReportId FROM Rapport WHERE erAktiv = 1 ORDER BY navn',
  );
  console.log('\nAlle aktive rapporter:');
  (alle.recordset as { navn: string; område: string; pbiReportId: string }[]).forEach(r =>
    console.log(`  [${r.område ?? '—'}] ${r.navn}`),
  );

  await pool.close();
}

main().catch(err => { console.error(err.message); process.exit(1); });
