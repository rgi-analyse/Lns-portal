import { queryAzureSQL } from './azureSqlService';

export interface KpiForslag {
  teknisk_navn: string;
  visningsnavn: string;
  sql_uttrykk:  string;
  format:       'prosent' | 'nok' | 'antall' | 'desimal';
  beskrivelse?: string;
}

/**
 * Scanner SELECT-listen i en SQL-spørring for aggregat-uttrykk og foreslår
 * dem som KPI-kandidater. Brukes av create_report-flyten i AI-chat: når AI
 * har bygd en rapport med f.eks. SUM(Beløp) eller en ratio, kan vi tilby
 * brukeren å lagre uttrykket som en gjenbrukbar KPI.
 *
 * Utelukker:
 * - Bare kolonne-referanser uten aggregering (f.eks. [måned]).
 * - Uttrykk som matcher et eksisterende KPI for samme view (sql_uttrykk
 *   eller navn).
 * - Uttrykk uten AS-alias — uten alias har KPI-en ikke noe naturlig navn.
 */
export async function detekterKpiKandidater(
  sql: string,
  schemaNavn: string,
  viewNavn: string,
): Promise<KpiForslag[]> {
  if (!sql || !schemaNavn || !viewNavn) return [];

  const selectListe = trekkUtSelectListe(sql);
  if (!selectListe) return [];

  const elementer = splittTopLevelKomma(selectListe);

  // Hent eksisterende KPI-er for viewet (for dedup)
  let eksisterende: { navn: string; sql_uttrykk: string }[] = [];
  try {
    const safeSchema = schemaNavn.replace(/'/g, "''");
    const safeView   = viewNavn.replace(/'/g, "''");
    const rader = await queryAzureSQL(`
      SELECT k.navn, k.sql_uttrykk
      FROM ai_metadata_kpi k
      JOIN ai_metadata_views v ON k.view_id = v.id
      WHERE v.schema_name = '${safeSchema}'
        AND v.view_name   = '${safeView}'
        AND k.er_aktiv    = 1
    `);
    eksisterende = rader.map(r => ({
      navn:        String(r['navn'] ?? ''),
      sql_uttrykk: normalisertUttrykk(String(r['sql_uttrykk'] ?? '')),
    }));
  } catch {
    // Ikke kritisk — fortsett uten dedup hvis oppslaget feiler
  }

  const forslag: KpiForslag[] = [];
  const settUttrykk = new Set(eksisterende.map(e => e.sql_uttrykk));
  const settNavn    = new Set(eksisterende.map(e => e.navn.toLowerCase()));
  const settFraThis = new Set<string>(); // unngå duplikat-forslag i samme rapport

  for (const e of elementer) {
    const ekstrahert = ekstraherUttrykkOgAlias(e);
    if (!ekstrahert) continue;
    const { uttrykk, alias } = ekstrahert;

    if (!erAggregatUttrykk(uttrykk)) continue;

    const teknisk = normaliserTekniskNavn(alias);
    if (!teknisk) continue;

    const norm = normalisertUttrykk(uttrykk);
    if (settUttrykk.has(norm)) continue;
    if (settNavn.has(teknisk.toLowerCase())) continue;
    if (settFraThis.has(norm)) continue;
    settFraThis.add(norm);

    forslag.push({
      teknisk_navn: teknisk,
      visningsnavn: alias,
      sql_uttrykk:  uttrykk,
      format:       gjettFormat(uttrykk, alias),
    });
  }

  return forslag;
}

// ─── Parsing-hjelpere ────────────────────────────────────────────────────────

function trekkUtSelectListe(sql: string): string | null {
  // Match SELECT (eventuelt TOP N / DISTINCT) ... FROM
  const m = sql.match(/\bSELECT\b(?:\s+TOP\s+\d+)?(?:\s+DISTINCT)?([\s\S]+?)\bFROM\b/i);
  return m ? m[1].trim() : null;
}

function splittTopLevelKomma(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0, inStr = false, strCh = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === strCh) inStr = false;
      continue;
    }
    if (c === "'" || c === '"') { inStr = true; strCh = c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map(p => p.trim()).filter(Boolean);
}

function ekstraherUttrykkOgAlias(elem: string): { uttrykk: string; alias: string } | null {
  // Trailing AS [navn] eller AS navn
  const m = elem.match(/^([\s\S]+?)\s+AS\s+(?:\[([^\]]+)\]|([\p{L}\p{N}_]+))\s*$/iu);
  if (!m) return null;
  const uttrykk = m[1].trim();
  const alias   = (m[2] ?? m[3]).trim();
  if (!uttrykk || !alias) return null;
  return { uttrykk, alias };
}

function erAggregatUttrykk(uttrykk: string): boolean {
  // Bare en bracket-kolonne — ikke aggregat
  if (/^\[[^\]]+\]\s*$/.test(uttrykk)) return false;
  // Bare et bart identifikator — ikke aggregat
  if (/^[\p{L}_][\p{L}\p{N}_]*\s*$/u.test(uttrykk)) return false;

  if (/\b(SUM|COUNT|AVG|MIN|MAX|MEDIAN|PERCENTILE_CONT|STDEV|VAR)\s*\(/i.test(uttrykk)) return true;
  if (/\bCASE\s+WHEN\b/i.test(uttrykk)) return true;
  return false;
}

function normaliserTekniskNavn(alias: string): string {
  return alias
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .replace(/^_+|_+$/g, '');
}

function normalisertUttrykk(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// ─── Format-heuristikk ───────────────────────────────────────────────────────

const NOK_HINT = /(beløp|belop|kost|pris|verdi|omsetning|l[øo]nn|honorar|salær|salar|inntekt|utgift|fakturasum|dekningsbidrag)/i;
const ANTALL_HINT = /(antall|count|bilag|hendelse|registrering|forekomst|stk)/i;

function gjettFormat(uttrykk: string, alias: string): 'prosent' | 'nok' | 'antall' | 'desimal' {
  const tekst = `${uttrykk} ${alias}`;

  // Ratio-mønstre: aggregat / aggregat eller aggregat / NULLIF(aggregat, 0)
  if (/\bSUM\s*\(.+?\)\s*\/\s*(?:NULLIF\s*\(\s*)?(?:SUM|COUNT)\s*\(/is.test(uttrykk)) return 'prosent';
  if (/(prosent|andel|rate|ratio)/i.test(alias)) return 'prosent';

  // Antall: COUNT(...) eller åpenbar antall-semantikk
  if (/^\s*COUNT\s*\(/i.test(uttrykk)) return 'antall';
  if (ANTALL_HINT.test(tekst)) return 'antall';

  // NOK: SUM på beløp-aktige kolonner eller alias
  if (/^\s*SUM\s*\(/i.test(uttrykk) && NOK_HINT.test(tekst)) return 'nok';

  return 'desimal';
}
