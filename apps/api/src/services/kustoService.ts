/**
 * KQL/Eventhouse-klient for live sensor-data.
 *
 * SIKKERHET:
 * - Service principal (gjenbruker PBI_*) med KUN Viewer på Eventhouse (read-only).
 * - Kusto har IKKE parametre for identifiers (tabell/kolonne) → kqlTabell og
 *   kqlVerdiFelt valideres strikt (/^[A-Za-z0-9_]+$/, maks 100 tegn) FØR
 *   interpolasjon. Verdier (SensorID, siden) går som ekte query-parametre.
 * - Ingen input interpoleres direkte. Tabell/felt kommer fra Sensor-tabellen
 *   (admin-kontrollert), ikke fra sluttbruker.
 *
 * POOLING: én KustoClient per prosess (singleton). Eventhouse er ett delt cluster
 * for LNS (single-tenant foreløpig) — i motsetning til azureSqlService som pooler
 * per tenant-DB.
 */
import { Client as KustoClient, KustoConnectionStringBuilder, ClientRequestProperties } from 'azure-kusto-data';
import { ClientSecretCredential } from '@azure/identity';
import { logger } from '../lib/logger';

let klient: KustoClient | null = null;

function getKustoClient(): KustoClient {
  if (klient) return klient;
  const cluster = process.env.KUSTO_CLUSTER_URI;
  if (!cluster) throw new Error('KUSTO_CLUSTER_URI mangler');
  const cred = new ClientSecretCredential(
    process.env.PBI_TENANT_ID ?? '',
    process.env.PBI_CLIENT_ID ?? '',
    process.env.PBI_CLIENT_SECRET ?? '',
  );
  const kcsb = KustoConnectionStringBuilder.withTokenCredential(cluster, cred);
  klient = new KustoClient(kcsb);
  return klient;
}

// Kusto-identifier (tabell/kolonne): kun bokstaver/tall/underscore, maks 100 tegn.
const IDENT_RE = /^[A-Za-z0-9_]+$/;
function validerIdent(verdi: string, felt: string): string {
  if (!verdi || verdi.length > 100 || !IDENT_RE.test(verdi)) {
    throw new Error(`Ugyldig KQL-identifier for ${felt}: "${verdi}"`);
  }
  return verdi;
}

function kravDb(): string {
  const db = process.env.KUSTO_DATABASE;
  if (!db) throw new Error('KUSTO_DATABASE mangler');
  return db;
}

export interface SensorPunkt {
  ts: string;              // ISO 8601 UTC
  value: number | null;
}

/**
 * Delta-fetch av sensor-tidsserie fra Eventhouse. `siden` = hent kun punkter
 * nyere enn dette (frontend sender siste mottatte timestamp).
 */
export async function hentSensorData(params: {
  kqlTabell: string;      // fra Sensor.kqlTabell (validert)
  kqlVerdiFelt: string;   // fra Sensor.kqlVerdiFelt (validert)
  kqlSensorId: string;    // fra Sensor.sensorId (parameter, ikke interpolert)
  siden: Date;
}): Promise<SensorPunkt[]> {
  const tabell = validerIdent(params.kqlTabell, 'kqlTabell');
  const felt = validerIdent(params.kqlVerdiFelt, 'kqlVerdiFelt');

  const query = `declare query_parameters(sid:string, siden:datetime);
${tabell}
| where SensorID == sid and ProsessTime > siden
| project Timestamp = ProsessTime, Value = ${felt}
| order by Timestamp asc`;

  const crp = new ClientRequestProperties();
  crp.setParameter('sid', params.kqlSensorId);
  crp.setParameter('siden', params.siden);
  crp.setTimeout(30_000);

  const resp = await getKustoClient().execute(kravDb(), query, crp);
  const punkter: SensorPunkt[] = [];
  for (const row of resp.primaryResults[0].rows()) {
    const obj = row.toJSON<{ Timestamp: string | Date; Value: number | null }>();
    punkter.push({ ts: new Date(obj.Timestamp).toISOString(), value: obj.Value });
  }
  return punkter;
}

/**
 * KUN for diagnostikk/test (scripts/testKql.ts). Kjører rå KQL uten
 * tilgangs-/parameter-validering — MÅ ALDRI eksponeres i en rute.
 */
export async function kjørDiagnoseKql(query: string): Promise<Record<string, unknown>[]> {
  const resp = await getKustoClient().execute(kravDb(), query);
  const rader: Record<string, unknown>[] = [];
  for (const row of resp.primaryResults[0].rows()) {
    rader.push(row.toJSON<Record<string, unknown>>());
  }
  return rader;
}

/** Nullstill klient (test/graceful-shutdown). */
export function lukkKustoClient(): void {
  klient = null;
}
