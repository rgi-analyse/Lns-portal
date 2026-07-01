/**
 * Sentral sensor-tilgang (analogt med datatilgang.ts). FAIL-CLOSED.
 *
 * Tilgangskjede: Bruker → Tilgang → Workspace → WorkspaceSensor → Sensor.
 * Kun workspace-Tilgang gir tilgang (IKKE opprettetAv — lærdom fra datatilgang).
 * Kun admin/tenantadmin er ubegrenset. Alle feil/tomme tilstander → nekt.
 *
 * allow-lista inneholder Sensor.id (Prisma-UUID). :id fra URL verifiseres mot
 * denne FØR noen KQL kjøres; KQL-identifikatoren (Sensor.sensorId/kqlTabell)
 * hentes fra DB etter tilgangssjekk — aldri fra URL (lukker id-spoofing).
 */
import { logger } from '../lib/logger';

export type SensorTilgang =
  | { mode: 'admin' }
  | { mode: 'begrenset'; tillatteSensorIds: ReadonlySet<string> };

export const INGEN_SENSORTILGANG: SensorTilgang = { mode: 'begrenset', tillatteSensorIds: new Set() };

// Løs strukturell type så en full PrismaClient (overloadet findMany) er tilordnbar.
interface TenantPrismaLike {
  workspace: {
    findMany: (args: any) => Promise<unknown>;
    findFirst: (args: any) => Promise<unknown>;
  };
}
type WsSensorRad = { sensorer: { sensorId: string }[] };

export interface SensorTilgangInput {
  erAdminTilgang: boolean;
  entraObjectId?: string | null;
  grupper?: string[];
  tenantPrisma: TenantPrismaLike;
}

export async function hentSensorTilgang(input: SensorTilgangInput): Promise<SensorTilgang> {
  if (input.erAdminTilgang) return { mode: 'admin' };

  const identities = [input.entraObjectId, ...(input.grupper ?? [])].filter(Boolean) as string[];
  if (identities.length === 0) return INGEN_SENSORTILGANG;

  try {
    const ws = await input.tenantPrisma.workspace.findMany({
      where: { tilgang: { some: { entraId: { in: identities } } } },   // kun Tilgang
      select: { sensorer: { where: { sensor: { erAktiv: true } }, select: { sensorId: true } } },
    }) as WsSensorRad[];
    const ids = new Set(ws.flatMap(w => w.sensorer.map(s => s.sensorId)));
    return ids.size === 0 ? INGEN_SENSORTILGANG : { mode: 'begrenset', tillatteSensorIds: ids };
  } catch (err) {
    logger.warn('[sensorTilgang] kunne ikke resolve tilgang — fail-closed:', err instanceof Error ? err.message : err);
    return INGEN_SENSORTILGANG;
  }
}

/** True hvis brukeren har tilgang til Sensor.id (UUID). Admin → alltid. */
export function harTilgangTilSensor(tilgang: SensorTilgang, sensorPrismaId: string): boolean {
  return tilgang.mode === 'admin' || tilgang.tillatteSensorIds.has(sensorPrismaId);
}

/**
 * Har brukeren tilgang til et workspace (via Tilgang)? Brukes av dashbord-rutene.
 * Fail-closed: admin → true; feil/tomt → false.
 */
export async function harWorkspaceTilgang(input: SensorTilgangInput, workspaceId: string): Promise<boolean> {
  if (input.erAdminTilgang) return true;
  const identities = [input.entraObjectId, ...(input.grupper ?? [])].filter(Boolean) as string[];
  if (identities.length === 0) return false;
  try {
    const ws = await input.tenantPrisma.workspace.findFirst({
      where: { id: workspaceId, tilgang: { some: { entraId: { in: identities } } } },
      select: { id: true },
    }) as { id: string } | null;
    return !!ws;
  } catch (err) {
    logger.warn('[sensorTilgang] harWorkspaceTilgang fail-closed:', err instanceof Error ? err.message : err);
    return false;
  }
}
