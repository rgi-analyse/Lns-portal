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

  // Alle RUH-rader
  const ruh = await pool.request().query(
    "SELECT r.id, r.navn, r.område, r.pbiReportId FROM Rapport r WHERE r.pbiReportId = 'ffd05808-dfd2-4465-a83f-474a51c757cf'",
  );
  console.log('\nRUH-rapport rader (per pbiReportId):');
  (ruh.recordset as Record<string, unknown>[]).forEach(r =>
    console.log(`  id=${r['id']}  navn="${r['navn']}"  område="${r['område']}"`)
  );

  // Sjekk WorkspaceRapport-koblinger for disse
  const ids = (ruh.recordset as { id: string }[]).map(r => `'${r.id}'`).join(',');
  if (ids) {
    const wr = await pool.request().query(
      `SELECT wr.rapportId, wr.workspaceId, w.navn as workspace_navn
       FROM WorkspaceRapport wr
       JOIN Workspace w ON wr.workspaceId = w.id
       WHERE wr.rapportId IN (${ids})`,
    );
    console.log('\nWorkspace-koblinger for disse rapportene:');
    (wr.recordset as Record<string, unknown>[]).forEach(r =>
      console.log(`  rapportId=${r['rapportId']}  workspace="${r['workspace_navn']}"`)
    );
  }

  // Sjekk Prisma-modellens kolonnenavn
  const cols = await pool.request().query(
    "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Rapport' ORDER BY ORDINAL_POSITION",
  );
  console.log('\nRapport-kolonner i databasen:');
  (cols.recordset as { COLUMN_NAME: string; DATA_TYPE: string }[]).forEach(c =>
    console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`)
  );

  await pool.close();
}

main().catch(err => { console.error(err.message); process.exit(1); });
