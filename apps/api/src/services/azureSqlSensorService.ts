/**
 * Azure SQL-datakilde for sensor-tidsserie (lns-dwh gold.*).
 *
 * SIKKERHET (samme prinsipp som kustoService):
 * - Read-only. Kun SELECT.
 * - mssql har IKKE parametre for identifiers (tabell/kolonne) → alle identifikator-
 *   felter valideres STRIKT med regex FØR de interpoleres (bracket-quotet). Verdier
 *   (@sensorId, @siden) går som ekte query-parametre.
 * - Identifikatorene kommer fra Sensor-tabellen (admin-kontrollert), aldri fra
 *   sluttbruker. Tilgang sjekkes i ruten FØR hentSerie (fail-closed, begge kilder).
 *
 * TILKOBLING: queryAzureSQL → DATABASE_URL → lns-dwh (for LNS er master == lns-dwh,
 * samme DB der gold.*-tabellene og ai_gold.*-viewene bor). Single-tenant, i tråd med
 * at Kusto-modulen også er single-tenant foreløpig.
 */
import { queryAzureSQL } from './azureSqlService';
import { logger } from '../lib/logger';
import type { SensorDataKilde, SensorKonfig, Datapunkt } from './sensorDataKilde';

/**
 * Øvre tak på antall datapunkter per henting. 30 min × 60 s × ~28 Hz ≈ 50k dekker
 * praktisk talt all industriell samplingsrate vi møter. Named constant — ikke magisk
 * tall. Håndheves som TOP i SQL-en OG som slice i queryAzureSQL; treff logges.
 */
export const MAKS_DATAPUNKTER_PER_HENTING = 50_000;

const AZURESQL_STANDARDVINDU_MS = 30 * 60 * 1000; // 30 min — som Kusto-kilden.

// Kolonne-identifier: kun bokstaver/tall/underscore, maks 100 tegn (som Kusto).
const IDENT_RE = /^[A-Za-z0-9_]+$/;
// Tabell: tillat punktum for schema.tabell (f.eks. gold.Fact_Skaland_Avlesing_Sensorer).
const TABELL_RE = /^[A-Za-z0-9_.]+$/;

function validerIdent(verdi: string, felt: string): string {
  if (!verdi || verdi.length > 100 || !IDENT_RE.test(verdi)) {
    throw new Error(`Ugyldig Azure SQL-identifier for ${felt}: "${verdi}"`);
  }
  return verdi;
}

/**
 * Validerer og bracket-quoter et (schema-kvalifisert) tabellnavn. Hver del må bestå
 * kolonne-regexen for seg — så `[gold].[Fact_...]`, ikke `[gold.Fact_...]` (som ville
 * vært ett feilaktig identifikator-navn). Godtar maks 2 deler (schema.tabell | tabell).
 */
function bracketTabell(tabell: string): string {
  if (!tabell || tabell.length > 200 || !TABELL_RE.test(tabell)) {
    throw new Error(`Ugyldig Azure SQL-tabell: "${tabell}"`);
  }
  const deler = tabell.split('.');
  if (deler.length > 2 || deler.some((d) => !d || !IDENT_RE.test(d))) {
    throw new Error(`Ugyldig Azure SQL-tabell (forventet [schema.]tabell): "${tabell}"`);
  }
  return deler.map((d) => `[${d}]`).join('.');
}

/** Sikkert bracket-quotet kolonnenavn (etter regex-validering). */
function bracketKol(verdi: string, felt: string): string {
  return `[${validerIdent(verdi, felt)}]`;
}

/** Delene en Azure SQL-sensor MÅ ha (etter presens- + regex-sjekk). */
function kravFelter(sensor: SensorKonfig): {
  tabell: string; idKolonne: string; verdiKolonne: string; tidKolonne: string;
} {
  const { azureSqlTabell, azureSqlIdKolonne, azureSqlVerdiKolonne, azureSqlTidKolonne } = sensor;
  if (!azureSqlTabell || !azureSqlIdKolonne || !azureSqlVerdiKolonne || !azureSqlTidKolonne) {
    throw new Error(
      'Azure SQL-sensor mangler ett eller flere felter (azureSqlTabell/IdKolonne/VerdiKolonne/TidKolonne).',
    );
  }
  return {
    tabell: azureSqlTabell,
    idKolonne: azureSqlIdKolonne,
    verdiKolonne: azureSqlVerdiKolonne,
    tidKolonne: azureSqlTidKolonne,
  };
}

export const azureSqlSensorKilde: SensorDataKilde = {
  validerKonfig(sensor: SensorKonfig): void {
    // Ren, synkron validering (ingen I/O) — presens + strikt regex. Speiles på
    // server-siden ved opprettelse så admin får umiddelbar feilmelding.
    const f = kravFelter(sensor);
    bracketTabell(f.tabell);
    validerIdent(f.idKolonne, 'azureSqlIdKolonne');
    validerIdent(f.verdiKolonne, 'azureSqlVerdiKolonne');
    validerIdent(f.tidKolonne, 'azureSqlTidKolonne');
  },

  async hentSerie(sensor: SensorKonfig, siden: Date | null): Promise<Datapunkt[]> {
    this.validerKonfig(sensor);
    const f = kravFelter(sensor);
    const tabell = bracketTabell(f.tabell);
    const idKol = bracketKol(f.idKolonne, 'azureSqlIdKolonne');
    const verdiKol = bracketKol(f.verdiKolonne, 'azureSqlVerdiKolonne');
    const tidKol = bracketKol(f.tidKolonne, 'azureSqlTidKolonne');
    const fra = siden ?? new Date(Date.now() - AZURESQL_STANDARDVINDU_MS);

    // TOP-taket er en validert konstant (ikke brukerdata) → trygt inlinet. Vi unngår
    // TOP (@param) fordi queryAzureSQL sender utypede inputs (fragilt for TOP).
    // @sensorId (nvarchar) mot en INT-kolonne: SQL Server konverterer PARAMETERET, ikke
    // kolonnen → seek/indeks bevares (sargbart).
    const query = `SELECT TOP (${MAKS_DATAPUNKTER_PER_HENTING})
    ${tidKol}   AS ts,
    ${verdiKol} AS value
  FROM ${tabell}
  WHERE ${idKol} = @sensorId
    AND ${tidKol} > @siden
  ORDER BY ${tidKol} ASC`;

    const rader = await queryAzureSQL(
      query,
      { sensorId: sensor.sensorId, siden: fra },
      MAKS_DATAPUNKTER_PER_HENTING,
    );

    if (rader.length >= MAKS_DATAPUNKTER_PER_HENTING) {
      logger.warn(
        `[azureSqlSensor] MAKS_DATAPUNKTER_PER_HENTING (${MAKS_DATAPUNKTER_PER_HENTING}) truffet for sensor ${sensor.sensorId} — eldste punkter returnert; frontend henter resten neste poll.`,
      );
    }

    const punkter: Datapunkt[] = [];
    for (const rad of rader) {
      const rawTs = (rad as { ts: unknown }).ts;
      if (rawTs == null) continue; // uten tidspunkt kan punktet ikke plasseres på aksen
      const rawVal = (rad as { value: unknown }).value;
      punkter.push({
        // toISOString() gir stabilt UTC-wire-format uansett datetime2/datetimeoffset.
        ts: new Date(rawTs as string | number | Date).toISOString(),
        value: rawVal == null ? null : Number(rawVal),
      });
    }
    return punkter;
  },
};

/**
 * ENGANGS-diagnostikk (provisjonering / manuell test), IKKE per-request. Verifiserer
 * at tid-kolonnen finnes og har en presis type (datetime2/datetimeoffset). Gammel
 * `datetime` gir kun en ADVARSEL — hentSerie konverterer uansett til ISO-UTC, men
 * `datetime` mister presisjon/tydelig tidssone og bør unngås.
 *
 * Tenkt kalt av admin-save (STEG 6, utsatt) og under den manuelle test-verifiseringen.
 */
export async function verifiserTidskolonne(sensor: SensorKonfig): Promise<{
  ok: boolean;
  kolonneType: string | null;
  advarsel?: string;
}> {
  azureSqlSensorKilde.validerKonfig(sensor);
  const f = kravFelter(sensor);
  const deler = f.tabell.split('.');
  const skjema = deler.length === 2 ? deler[0] : null;
  const tabellNavn = deler.length === 2 ? deler[1] : deler[0];

  // Metadata via INFORMATION_SCHEMA — verdiene går som ekte parametre (ingen interpolering).
  const meta = await queryAzureSQL(
    `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tabell AND COLUMN_NAME = @kol
        AND (@skjema IS NULL OR TABLE_SCHEMA = @skjema)`,
    { tabell: tabellNavn, kol: f.tidKolonne, skjema },
    5,
  );
  const kolonneType = meta.length ? String((meta[0] as { DATA_TYPE: unknown }).DATA_TYPE) : null;

  if (!kolonneType) {
    return { ok: false, kolonneType: null, advarsel: `Fant ikke kolonnen ${f.tidKolonne} i ${f.tabell}.` };
  }
  const presis = kolonneType === 'datetime2' || kolonneType === 'datetimeoffset';
  const resultat = {
    ok: true,
    kolonneType,
    ...(presis ? {} : { advarsel: `Tid-kolonnen er '${kolonneType}', ikke datetime2/datetimeoffset — presisjon/tidssone kan være upresis.` }),
  };
  if (!presis) logger.warn(`[azureSqlSensor] ${resultat.advarsel} (sensor ${sensor.sensorId})`);
  return resultat;
}
