/**
 * Abstraksjon over sensor-datakilder.
 *
 * En sensor henter tidsserie enten fra Kusto/Eventhouse (kustoService) eller
 * Azure SQL (azureSqlSensorService). Ruten (/api/sensor/:id/data) velger service
 * ut fra Sensor.dataKilde og kaller hentSerie — frontend ser samme JSON uansett.
 *
 * KONTRAKT som BEGGE implementasjoner MÅ holde:
 *  - Read-only. Ingen skriv/DDL.
 *  - Tilgang er ALLEREDE sjekket i ruten FØR hentSerie kalles (fail-closed gjelder
 *    begge kilder — denne modulen antar tilgang er gitt).
 *  - Identifikatorer (tabell/kolonne) valideres STRIKT med regex FØR interpolering.
 *    Verken Kusto eller mssql har query-parametre for identifiers; kun verdier
 *    (sensorId, siden) går som ekte parametre.
 *  - Retur er samme wire-format som frontend allerede leser (se Datapunkt).
 */
import type { Sensor } from '../generated/prisma/client';

/**
 * Ett tidsserie-punkt slik det sendes til frontend.
 *
 * @property ts     ISO 8601-tidsstempel i **UTC** (f.eks. "2026-07-13T09:41:02.000Z").
 *                  ALLTID streng — IKKE konverter til Date. Frontend/kontrollrommet
 *                  leser dette formatet direkte; en `Date` her ville endret wire-JSON.
 * @property value  Målt verdi, eller `null` for GAP/manglende måling. `null` betyr
 *                  «ingen måling i dette punktet» — det er IKKE 0. Ikke koales til 0;
 *                  grafen skal vise brudd, ikke en falsk nullverdi.
 *
 * MERK bevisst avvik fra skissen (`{ ts: Date; value: number }`): streng-`ts` og
 * nullbar `value` er valgt for å bevare det EKSAKTE eksisterende wire-formatet
 * (Kusto ga alltid ISO-streng + nullbare målinger). Kravet «frontend uendret» styrer.
 */
export type Datapunkt = { ts: string; value: number | null };

/**
 * Felter en datakilde-service trenger fra en sensor. Avledet fra Prisma-modellen
 * (holder seg i sync med schema) — ruten selecter nøyaktig disse og sender videre.
 */
export type SensorKonfig = Pick<
  Sensor,
  | 'sensorId'
  | 'dataKilde'
  | 'kqlTabell'
  | 'kqlVerdiFelt'
  | 'azureSqlTabell'
  | 'azureSqlIdKolonne'
  | 'azureSqlVerdiKolonne'
  | 'azureSqlTidKolonne'
>;

export interface SensorDataKilde {
  /**
   * Delta-fetch av tidsserie. Returner punkter STRENGT nyere enn `siden`
   * (`null` ⇒ tjenestens standardvindu), sortert stigende på tid.
   * Kaster ved I/O-/spørrefeil (ruten mapper til 502).
   */
  hentSerie(sensor: SensorKonfig, siden: Date | null): Promise<Datapunkt[]>;

  /**
   * Validerer at sensorens datakilde-konfig er komplett og trygg (påkrevde felter
   * satt for denne kilden, identifikatorer består regex). Ren validering — ingen
   * I/O. Kaster Error ved ugyldig konfig; kalles av hentSerie før spørring.
   */
  validerKonfig(sensor: SensorKonfig): void;
}
