import { queryAzureSQL } from './azureSqlService';

export interface ValideringsResultat {
  ok: boolean;
  feilmelding?: string;
}

const MAKS_LENGDE = 1000;

// Nøkkelord som ikke har noe å gjøre i et KPI-uttrykk. Vi matcher mot hele
// ord (\b) for å unngå false positives på f.eks. "DROPDOWN" som kolonnenavn.
const FORBUDTE_NOKKELORD = [
  'DROP', 'CREATE', 'ALTER', 'TRUNCATE',
  'DELETE', 'INSERT', 'UPDATE', 'MERGE',
  'EXEC', 'EXECUTE', 'GRANT', 'REVOKE',
  'XP_', 'SP_', 'OPENROWSET', 'OPENQUERY', 'BULK',
];

/**
 * Validerer et KPI-uttrykk før det lagres i ai_metadata_kpi.
 *
 * Kjøres ved opprettelse (admin POST og opprett_kpi-tool) og oppdatering
 * (admin PATCH). To-trinns validering:
 *   1. Statisk sjekk: lengde, forbudte tegn (;, kommentarer), forbudte
 *      nøkkelord (DDL, dynamic SQL).
 *   2. Live prøvekjøring mot viewet: `SELECT TOP 0 <uttrykk> AS _test
 *      FROM <schema>.<view>` — fanger syntaks-feil og refererte kolonner
 *      som ikke finnes.
 *
 * Tar IKKE høyde for semantiske feil (f.eks. SUM på en streng-kolonne uten
 * eksplisitt CAST) — Azure SQL melder typisk dette som syntaks-/typefeil
 * ved prøvekjøring.
 */
export async function validerKpiUttrykk(
  sqlUttrykk: string,
  schema: string,
  viewNavn: string,
): Promise<ValideringsResultat> {
  const uttrykk = sqlUttrykk?.trim() ?? '';
  if (!uttrykk) return { ok: false, feilmelding: 'SQL-uttrykk kan ikke være tomt.' };

  if (uttrykk.length > MAKS_LENGDE) {
    return { ok: false, feilmelding: `SQL-uttrykk er for langt (${uttrykk.length} > ${MAKS_LENGDE} tegn).` };
  }

  if (uttrykk.includes(';')) {
    return { ok: false, feilmelding: 'Semikolon (;) er ikke tillatt i KPI-uttrykk.' };
  }
  if (uttrykk.includes('--') || uttrykk.includes('/*')) {
    return { ok: false, feilmelding: 'SQL-kommentarer (-- eller /*) er ikke tillatt i KPI-uttrykk.' };
  }

  const upper = uttrykk.toUpperCase();
  for (const ord of FORBUDTE_NOKKELORD) {
    // \b matcher på ord-grenser; fanger DROP men ikke DROPDOWN
    const re = new RegExp(`\\b${ord.replace(/_/g, '_')}\\b`, 'i');
    if (re.test(upper)) {
      return { ok: false, feilmelding: `Nøkkelordet "${ord}" er ikke tillatt i KPI-uttrykk.` };
    }
  }

  // Trygg-å-bygge view-referanse: fjern alt utenfor [\p{L}\p{N}_] (æøå
  // bevares) og wrap i brackets. Vi parameteriserer ikke kolonne-/view-navn
  // i mssql.
  const safeSchema = schema.replace(/[^\p{L}\p{N}_]/gu, '');
  const safeView   = viewNavn.replace(/[^\p{L}\p{N}_]/gu, '');
  if (!safeSchema || !safeView) {
    return { ok: false, feilmelding: 'Ugyldig view-referanse for prøvekjøring.' };
  }

  try {
    await queryAzureSQL(
      `SELECT TOP 0 (${uttrykk}) AS _test FROM [${safeSchema}].[${safeView}]`,
    );
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      feilmelding: `SQL-uttrykk feilet ved prøvekjøring mot ${safeSchema}.${safeView}: ${msg}`,
    };
  }
}
