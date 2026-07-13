/**
 * Registry over sensor-datakilder: dataKilde-streng → SensorDataKilde-implementasjon.
 *
 * Ruten slår opp her ETTER tilgangssjekk (som er kilde-agnostisk, se sensorTilgang.ts).
 * Fail-closed: ukjent dataKilde → null → ruten svarer feil og henter ALDRI data. Å ha
 * ett felles oppslag hindrer kilde-spesifikk bypass (samme gate for alle kilder).
 */
import type { SensorDataKilde } from './sensorDataKilde';
import { kustoSensorKilde } from './kustoService';
import { azureSqlSensorKilde } from './azureSqlSensorService';

export const DATAKILDER = {
  kusto: kustoSensorKilde,
  azuresql: azureSqlSensorKilde,
} as const;

export type DataKildeNavn = keyof typeof DATAKILDER;

/** Gyldige dataKilde-verdier (for schema-enum og klient-validering). */
export const GYLDIGE_DATAKILDER = Object.keys(DATAKILDER) as DataKildeNavn[];

/**
 * Velg datakilde-service. Fail-closed: ukjent kilde → null (ruten henter aldri data).
 */
export function velgSensorKilde(dataKilde: string): SensorDataKilde | null {
  return (DATAKILDER as Record<string, SensorDataKilde>)[dataKilde] ?? null;
}
