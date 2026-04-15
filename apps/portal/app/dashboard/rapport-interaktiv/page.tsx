'use client';
// v2 — kumulativ sum per serie

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, FileSpreadsheet, Save } from 'lucide-react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

interface RapportForslag {
  tittel: string;
  beskrivelse?: string;
  visualType: string;
  xAkse?: string;
  yAkse?: string;
  grupperPaa?: string;
  sql: string;
  data: Record<string, unknown>[];
  foreslåSlicere?: string[];
  alleViewKolonner?: { kolonne_navn: string; kolonne_type: string; sql_uttrykk?: string; format?: string; visningsnavn?: string }[];
  viewNavn?: string | null;
  prosjektNr?: string | null;
  prosjektNavn?: string | null;
  prosjektKolonne?: string | null;
  prosjektKolonneType?: string | null;
  prosjektFilter?: string | null;
  laastFilter?: { kolonne: string; verdi: string } | null;
}

interface KombinertSerie {
  id:           string;
  navn:         string;
  kolonne:      string;
  aggregering:  string;
  filterKol:    string;
  filterOp:     string;
  filterVerdi:  string;
  visningsType: 'stolpe' | 'linje';
  kumulativ:    boolean;
}

interface RedigertConfig {
  visualType:       string;
  xAkse:            string;
  yAkse:            string;
  aggregering:      string;
  grupperPaa:       string | null;
  ekstraKolonner:   string[];
  kombinertSerier:  KombinertSerie[];
  sorterPaa:        string | null;
  sorterRetning:    string;
  maksRader:        number;
}

interface AktivFilter {
  kolonne:  string;
  operator: string;
  verdi:    string;
  verdi2?:  string;    // brukes for BETWEEN: [årmåned] BETWEEN verdi AND verdi2
  erLåst?:  boolean;  // true = låst av workspace-kontekst (prosjektfilter), vises uten ×-knapp
}

const API    = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const COLORS = ['var(--gold)','#3B82F6','#10B981','#8B5CF6','#F43F5E','#06B6D4','#F97316','#84CC16'];

const VIS_TYPE_OPTIONS = [
  { type: 'bar',       ikon: '📊', navn: 'Stolpe' },
  { type: 'line',      ikon: '📈', navn: 'Linje' },
  { type: 'area',      ikon: '📉', navn: 'Område' },
  { type: 'pie',       ikon: '🥧', navn: 'Pai' },
  { type: 'table',     ikon: '📋', navn: 'Tabell' },
  { type: 'card',      ikon: '🔢', navn: 'Kort' },
  { type: 'kombinert', ikon: '📊', navn: 'Kombinert' },
];

const AGG_OPTIONS = [
  { verdi: 'SUM',            ikon: 'Σ',  navn: 'Sum' },
  { verdi: 'COUNT',          ikon: '#',  navn: 'Antall' },
  { verdi: 'COUNT_DISTINCT', ikon: '◇',  navn: 'Distinkt' },
  { verdi: 'AVG',            ikon: 'x̄',  navn: 'Snitt' },
  { verdi: 'MAX',            ikon: '↑',  navn: 'Maks' },
  { verdi: 'MIN',            ikon: '↓',  navn: 'Min' },
  { verdi: 'MEDIAN',         ikon: '~',  navn: 'Median' },
  { verdi: 'NONE',           ikon: '≡',  navn: 'Ingen' },
];

const OPERATORER = [
  { verdi: '=',        label: 'er lik' },
  { verdi: '!=',       label: 'er ikke lik' },
  { verdi: '>',        label: 'større enn' },
  { verdi: '<',        label: 'mindre enn' },
  { verdi: '>=',       label: 'st.el.' },
  { verdi: '<=',       label: 'mi.el.' },
  { verdi: 'LIKE',     label: 'inneholder' },
  { verdi: 'NOT LIKE', label: 'inneh. ikke' },
  { verdi: 'BETWEEN',  label: 'mellom' },
];

const selectStyle: React.CSSProperties = {
  width: '100%', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
  color: 'var(--text-primary)', borderRadius: 7, padding: '7px 10px', fontSize: 13,
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em',
  textTransform: 'uppercase', display: 'block', marginBottom: 6,
};

// ── Filter helpers ────────────────────────────────────────────────────────────

const PROSJEKT_KOLONNER = new Set([
  'prosjektnr','prosjektid','prosjektid','project_id','projectid',
  'prosjekt_id','projectnr','project_nr',
]);

/** Parse eksisterende SQL WHERE-betingelser (unntatt prosjektfilter) til AktivFilter-objekter.
 *  Fjerner alltid prosjektKolonne-betingelser for å unngå duplikater med det låste prosjektfilteret. */
function parseFiltreTilObjekter(
  sql: string,
  prosjektFilter: string,
  prosjektKolonne?: string | null,
): AktivFilter[] {
  if (!sql) return [];
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|$)/is);
  if (!whereMatch) return [];
  let where = whereMatch[1].trim();
  if (prosjektFilter) {
    const proj = prosjektFilter.replace(/^WHERE\s+/i, '').trim();
    if (proj) where = where.replace(proj, '').replace(/^\s*AND\s+/i, '').replace(/\s+AND\s*$/i, '').trim();
  }
  if (!where) return [];
  // Fjern ytre parenteser rundt hele WHERE-blokken (AI skriver av og til "(a AND b)")
  where = where.replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim();
  // Beskytt BETWEEN val1 AND val2 mot naiv AND-splitting:
  // "[Årsperiode] BETWEEN 202401 AND 202412" ellers splittes i "[Årsperiode] BETWEEN 202401" og "202412"
  const beskyttet = where.replace(/\bBETWEEN\s+(\S+)\s+AND\s+(\S+)/gi, 'BETWEEN $1 __BAND__ $2');
  return beskyttet
    .split(/\s+AND\s+/i)
    .map((b): AktivFilter | null => {
      b = b.replace(/__BAND__/g, 'AND').replace(/^\(|\)$/g, '').trim(); // gjenopprett BETWEEN's AND
      if (!b || /\s+OR\s+/i.test(b)) return null; // ignorer OR-betingelser — for komplekse for filter-UI

      // BETWEEN: [kolonne] BETWEEN val1 AND val2
      const bm = b.match(/^\[?([^\]]+)\]?\s+BETWEEN\s+(\S+)\s+AND\s+(\S+)$/i);
      if (bm) return { kolonne: bm[1].trim(), operator: 'BETWEEN', verdi: bm[2].trim(), verdi2: bm[3].trim() };

      // Vanlig: [kolonne] operator verdi
      const m = b.match(/^\[?([^\]]+)\]?\s+(NOT LIKE|LIKE|>=|<=|!=|>|<|=)\s+'?%?([^'%]*?)%?'?$/i);
      if (m) return { kolonne: m[1].trim(), operator: m[2].toUpperCase(), verdi: m[3].trim() };

      return null;
    })
    .filter((f): f is AktivFilter => {
      if (f === null) return false;
      const kolLower = f.kolonne.toLowerCase().replace(/[\[\]]/g, '');
      // Fjern filtre på prosjektkolonnen (eksplisitt navn eller kjente prosjekt-nøkkelkolonner)
      if (prosjektKolonne && kolLower === prosjektKolonne.toLowerCase()) {
        console.log('[parseFiltre] fjerner prosjektkolonne-filter:', f.kolonne);
        return false;
      }
      if (PROSJEKT_KOLONNER.has(kolLower)) {
        console.log('[parseFiltre] fjerner kjent prosjektnøkkel-filter:', f.kolonne);
        return false;
      }
      return true;
    });
}

/** Bygg full WHERE-klausul fra prosjektfilter + brukerfiltre.
 *  Prosjektfilter bygges fra eksplisitte kolonnenavn + verdi hvis tilgjengelig,
 *  ellers fra pre-bygd prosjektFilter-streng.
 *  prosjektKolonne-filtre hoppes over i aktiveFiltre for å unngå duplikater. */
const NUMERISK_DATATYPER = new Set([
  'int','bigint','decimal','float','numeric','money','smallmoney',
  'smallint','tinyint','real',
]);

function byggWhereKlausul(
  prosjektFilter: string | null | undefined,
  filtre: AktivFilter[],
  prosjektKolonne?: string | null,
  prosjektNr?: string | null,
  alleViewKolonner?: { kolonne_navn: string; kolonne_type: string; datatype?: string }[],
): string {
  const betingelser: string[] = [];
  if (prosjektKolonne && prosjektNr) {
    const verdi = isNaN(Number(prosjektNr)) ? `'${prosjektNr}'` : String(prosjektNr);
    betingelser.push(`[${prosjektKolonne}] = ${verdi}`);
  } else if (prosjektFilter) {
    betingelser.push(prosjektFilter.replace(/^WHERE\s+/i, '').trim());
  }
  filtre
    .filter(f => {
      if (!f.kolonne) return false;
      // IS NOT NULL / IS NULL trenger ingen verdi
      if (f.operator === 'IS NOT NULL' || f.operator === 'IS NULL') return true;
      // BETWEEN krever begge verdier
      if (f.operator === 'BETWEEN') return !!(f.verdi && f.verdi2);
      if (!f.verdi) return false;
      if (prosjektKolonne && f.kolonne === prosjektKolonne) return false;
      return true;
    })
    .forEach(f => {
      if (f.operator === 'IS NOT NULL' || f.operator === 'IS NULL') {
        betingelser.push(`[${f.kolonne}] ${f.operator}`);
        return;
      }
      if (f.operator === 'BETWEEN' && f.verdi2) {
        const meta = alleViewKolonner?.find(k => k.kolonne_navn === f.kolonne);
        const erNumerisk = meta?.datatype
          ? NUMERISK_DATATYPER.has(meta.datatype.toLowerCase())
          : !isNaN(Number(f.verdi));
        const v1 = erNumerisk ? f.verdi  : `'${f.verdi}'`;
        const v2 = erNumerisk ? f.verdi2 : `'${f.verdi2}'`;
        betingelser.push(`[${f.kolonne}] BETWEEN ${v1} AND ${v2}`);
        return;
      }
      let verdi: string;
      if (f.operator === 'LIKE' || f.operator === 'NOT LIKE') {
        verdi = `'%${f.verdi}%'`;
      } else {
        // Bruk datatype fra metadata for å avgjøre quoting — ikke gjett fra verdi
        const meta = alleViewKolonner?.find(k => k.kolonne_navn === f.kolonne);
        const erNumerisk = meta?.datatype
          ? NUMERISK_DATATYPER.has(meta.datatype.toLowerCase())
          : !isNaN(Number(f.verdi)); // fallback: gjett fra verdi
        verdi = erNumerisk ? f.verdi : `'${f.verdi}'`;
      }
      betingelser.push(`[${f.kolonne}] ${f.operator} ${verdi}`);
    });
  return betingelser.length > 0 ? `WHERE ${betingelser.join(' AND ')}` : '';
}

// ── Smart default sorteringsretning ──────────────────────────────────────────
function defaultSorterRetning(xAkse: string): 'ASC' | 'DESC' {
  const tidskolonner = ['månedsnavn', 'månednavn', 'år', 'måned', 'årmåned'];
  return tidskolonner.includes(xAkse?.toLowerCase()) ? 'ASC' : 'DESC';
}

// ── SQL builder ───────────────────────────────────────────────────────────────
function byggSQL(cfg: RedigertConfig, viewNavn: string, prosjektFilter = '', kolonnTyper: Record<string, string> = {}, kpiUttrykk: Record<string, string> = {}): string {
  const esc   = (s: string) => `[${s.replace(/[\[\]]/g, '')}]`;
  const x     = esc(cfg.xAkse);
  const y     = esc(cfg.yAkse);
  const alias = esc(cfg.yAkse);
  // KPI-kolonner bruker pre-definert SQL-uttrykk direkte (allerede aggregert)
  const kpiExpr = kpiUttrykk[cfg.yAkse];
  // Ikke inkluder grupperPaa hvis den er identisk med xAkse — unngår duplikat i SELECT/GROUP BY
  const grp   = (cfg.grupperPaa && cfg.grupperPaa !== cfg.xAkse) ? esc(cfg.grupperPaa) : null;

  let yUttrykk: string;
  let isMed = false;
  if (kpiExpr) {
    yUttrykk = kpiExpr; // KPI bruker sitt SQL-uttrykk direkte
  } else {
    switch (cfg.aggregering) {
      case 'NONE':           yUttrykk = y; break;
      case 'COUNT':          yUttrykk = `COUNT(${y})`; break;
      case 'COUNT_DISTINCT': yUttrykk = `COUNT(DISTINCT ${y})`; break;
      case 'SUM':            yUttrykk = `SUM(${y})`; break;
      case 'AVG':            yUttrykk = `AVG(CAST(${y} AS FLOAT))`; break;
      case 'MAX':            yUttrykk = `MAX(${y})`; break;
      case 'MIN':            yUttrykk = `MIN(${y})`; break;
      case 'MEDIAN': {
        // PERCENTILE_CONT is a window function in T-SQL — use PARTITION BY x (and grp)
        const partCols = grp ? `${x}, ${grp}` : x;
        yUttrykk = `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${y}) OVER (PARTITION BY ${partCols})`;
        isMed = true;
        break;
      }
      default:               yUttrykk = y;
    }
  }

  const erAggregert = kpiExpr ? true : (cfg.aggregering !== 'NONE' && !isMed);

  // Linje-serie for kombinert chart — CASE WHEN-serier eller enkel linje-kolonne
  const kombSerier = cfg.visualType === 'kombinert' ? (cfg.kombinertSerier ?? []) : [];
  let ekstraSelect = '';
  if (kombSerier.length > 0) {
    // Generer CASE WHEN-kolonner fra definerte serier
    ekstraSelect = kombSerier.map(s => {
      const fKol = `[${s.filterKol.replace(/[\[\]]/g, '')}]`;
      const vKol = `[${s.kolonne.replace(/[\[\]]/g, '')}]`;
      const sNavn = `[${s.navn.replace(/[\[\]]/g, '')}]`;
      const op = s.filterOp === 'LIKE'
        ? `${fKol} LIKE '${s.filterVerdi}'`
        : `${fKol} ${s.filterOp} '${s.filterVerdi}'`;
      const agg = s.aggregering || cfg.aggregering;
      return `, ${agg}(CASE WHEN ${op} THEN ${vKol} ELSE 0 END) AS ${sNavn}`;
    }).join('');
  } else {
    // Fallback: enkel linje-kolonne
    const linjeKolNavn = cfg.ekstraKolonner?.[0] ?? null;
    const linjeKolEsc  = linjeKolNavn ? esc(linjeKolNavn) : null;
    const linjeKolType = linjeKolNavn ? kolonnTyper[linjeKolNavn] : null;
    const erNumeriskLinje = linjeKolType?.startsWith('measure');
    const linjeAgg = erNumeriskLinje ? cfg.aggregering : 'COUNT';
    const linjeUttrykk = linjeKolEsc
      ? (linjeAgg === 'NONE'           ? linjeKolEsc
        : linjeAgg === 'COUNT'          ? `COUNT(${linjeKolEsc})`
        : linjeAgg === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${linjeKolEsc})`
        : linjeAgg === 'AVG'            ? `AVG(CAST(${linjeKolEsc} AS FLOAT))`
        : linjeAgg === 'MAX'            ? `MAX(${linjeKolEsc})`
        : linjeAgg === 'MIN'            ? `MIN(${linjeKolEsc})`
        : `SUM(${linjeKolEsc})`)
      : null;
    ekstraSelect = (linjeUttrykk && linjeKolEsc) ? `, ${linjeUttrykk} AS ${linjeKolEsc}` : '';
  }

  const grpKols = grp ? `${x}, ${grp}` : x;

  const where = prosjektFilter ? ` ${prosjektFilter}` : '';

  // Kronologisk sortering: månedsnavn sorteres via [måned]-kolonnen (tall), ikke alfabetisk
  const erMånedsnavn = ['månedsnavn', 'månednavn'].includes(cfg.xAkse.toLowerCase());
  // [måned] must be in both SELECT and GROUP BY for ORDER BY [måned] to work in SQL Server
  const ekstraMånedSel = erMånedsnavn ? ', [måned]' : '';
  const ekstraGroupBy  = erMånedsnavn ? ', [måned]' : '';

  const selKols = grp
    ? `${x}${ekstraMånedSel}, ${grp}, ${yUttrykk} AS ${alias}${ekstraSelect}`
    : `${x}${ekstraMånedSel}, ${yUttrykk} AS ${alias}${ekstraSelect}`;

  // Kolonner som må castes til INT for riktig sortering (ikke alfabetisk)
  const tallKolonner = new Set(['måned', 'år', 'årmåned', 'åruke', 'kontonr']);
  const byggOrderBy = (kol: string, retning: string): string =>
    tallKolonner.has(kol?.toLowerCase())
      ? `ORDER BY CAST([${kol}] AS INT) ${retning}`
      : `ORDER BY [${kol}] ${retning}`;

  if (isMed) {
    // Window function: wrap in subquery with DISTINCT to deduplicate rows
    const innerPart = grp
      ? `SELECT DISTINCT ${x}, ${grp}, ${yUttrykk} AS ${alias} FROM ${viewNavn}${where}`
      : `SELECT DISTINCT ${x}, ${yUttrykk} AS ${alias} FROM ${viewNavn}${where}`;
    const orderPart = cfg.sorterPaa
      ? byggOrderBy(cfg.sorterPaa, cfg.sorterRetning)
      : byggOrderBy(cfg.xAkse, cfg.sorterRetning);
    return `SELECT TOP 500 * FROM (${innerPart}) _med ${orderPart}`;
  }

  const groupBy = erAggregert ? `GROUP BY ${grpKols}${ekstraGroupBy}` : '';
  // Default: sorter på x-aksen (ikke y-aksen). månedsnavn sorteres via [måned] (INT).
  const orderBy = cfg.sorterPaa
    ? byggOrderBy(cfg.sorterPaa, cfg.sorterRetning)
    : erMånedsnavn
      ? `ORDER BY CAST([måned] AS INT) ${cfg.sorterRetning}`
      : byggOrderBy(cfg.xAkse, cfg.sorterRetning);

  return `SELECT TOP 500 ${selKols} FROM ${viewNavn}${where} ${groupBy} ${orderBy}`.replace(/\s+/g, ' ').trim();
}

// ── SQL builder for multi-column table view ───────────────────────────────────
function byggTabelSQL(
  kolonneListe: string[],
  kolonnTyper: Record<string, string>,
  aggregering: string,
  viewNavn: string,
  maksRader: number,
  prosjektFilter = '',
): string {
  const esc   = (s: string) => `[${s.replace(/[\[\]]/g, '')}]`;
  const where = prosjektFilter ? ` ${prosjektFilter}` : '';
  if (kolonneListe.length === 0) return `SELECT TOP ${maksRader} * FROM ${viewNavn}${where} ORDER BY 1`;
  const measures = kolonneListe.filter(k => kolonnTyper[k] === 'measure');
  const dims     = kolonneListe.filter(k => kolonnTyper[k] !== 'measure');
  if (measures.length === 0 || dims.length === 0) {
    return `SELECT TOP ${maksRader} ${kolonneListe.map(esc).join(', ')} FROM ${viewNavn}${where} ORDER BY 1`;
  }
  const agg = aggregering === 'NONE' ? 'SUM' : aggregering;
  const select = [
    ...dims.map(esc),
    ...measures.map(k => `${agg}(${esc(k)}) AS ${esc(k)}`),
  ].join(', ');
  const groupBy = dims.map(esc).join(', ');
  return `SELECT TOP ${maksRader} ${select} FROM ${viewNavn}${where} GROUP BY ${groupBy} ORDER BY 1`;
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportToCsv(data: Record<string, unknown>[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${filename}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Bar chart ─────────────────────────────────────────────────────────────────
function BarChart({ data, xCol, yCol, grupperPaa, yLabel, yFormat, formaterVerdi }: { data: Record<string,unknown>[]; xCol: string; yCol: string; grupperPaa?: string | null; yLabel: string; yFormat?: string; formaterVerdi?: (v: number, fmt?: string) => string }) {
  const fmt = (v: number) => formaterVerdi ? formaterVerdi(v, yFormat) : v.toLocaleString('nb-NO', { maximumFractionDigits: 0 });
  const W = 800, H = 400, padL = 80, padR = 20, padT = 20, padB = 90;
  const groups     = grupperPaa ? [...new Set(data.map(r => String(r[grupperPaa] ?? '')))] : [''];
  const categories = [...new Set(data.map(r => String(r[xCol] ?? '')))];
  const grouped: Record<string, Record<string, number>> = {};
  for (const r of data) {
    const cat = String(r[xCol] ?? '');
    const grp = grupperPaa ? String(r[grupperPaa] ?? '') : '';
    if (!grouped[cat]) grouped[cat] = {};
    grouped[cat][grp] = (grouped[cat][grp] ?? 0) + (Number(r[yCol]) || 0);
  }
  const allVals = categories.flatMap(c => groups.map(g => grouped[c]?.[g] ?? 0));
  const maxVal  = Math.max(...allVals, 1);
  const plotW   = W - padL - padR;
  const plotH   = H - padT - padB;
  const groupW  = plotW / Math.max(categories.length, 1);
  const barW    = Math.max(4, (groupW * 0.8) / groups.length);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {/* Y-axis label */}
      <text x={14} y={padT + plotH / 2} fontSize={10} fill="var(--text-muted)" textAnchor="middle" transform={`rotate(-90,14,${padT + plotH / 2})`}>{yLabel}</text>
      {[0,.25,.5,.75,1].map(t => {
        const y = padT + plotH - t * plotH;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={padL+plotW} y2={y} stroke="var(--glass-bg-hover)"/>
            <text x={padL-6} y={y+4} fontSize={11} textAnchor="end" fill="var(--text-muted)">
              {fmt(t*maxVal)}
            </text>
          </g>
        );
      })}
      {categories.map((cat, ci) => {
        const cx = padL + ci * groupW + groupW * 0.1;
        return (
          <g key={cat}>
            {groups.map((grp, gi) => {
              const val = grouped[cat]?.[grp] ?? 0;
              const bh  = Math.max(1, (val/maxVal)*plotH);
              const bx  = cx + gi*(barW+1);
              const by  = padT + plotH - bh;
              return (
                <g key={grp}>
                  <rect x={bx} y={by} width={barW} height={bh} fill={COLORS[gi%COLORS.length]} rx={2} opacity={0.85}/>
                  {bh>20 && <text x={bx+barW/2} y={by+12} fontSize={9} textAnchor="middle" fill="var(--text-secondary)">{fmt(val)}</text>}
                </g>
              );
            })}
            <text x={padL+ci*groupW+groupW/2} y={padT+plotH+16} fontSize={11} textAnchor="middle" fill="var(--text-secondary)"
              transform={`rotate(-30,${padL+ci*groupW+groupW/2},${padT+plotH+16})`}>
              {cat.slice(0,14)}
            </text>
          </g>
        );
      })}
      <line x1={padL} y1={padT} x2={padL} y2={padT+plotH} stroke="var(--text-muted)"/>
      <line x1={padL} y1={padT+plotH} x2={padL+plotW} y2={padT+plotH} stroke="var(--text-muted)"/>
      {grupperPaa && groups.map((g,i) => (
        <g key={g}>
          <rect x={padL+i*120} y={H-20} width={10} height={10} fill={COLORS[i%COLORS.length]} rx={1}/>
          <text x={padL+i*120+14} y={H-11} fontSize={11} fill="var(--text-secondary)">{g.slice(0,14)}</text>
        </g>
      ))}
    </svg>
  );
}

// ── Line / Area chart ─────────────────────────────────────────────────────────
function LineChart({ data, xCol, yCol, area, yLabel, yFormat, formaterVerdi }: { data: Record<string,unknown>[]; xCol: string; yCol: string; area?: boolean; yLabel: string; yFormat?: string; formaterVerdi?: (v: number, fmt?: string) => string }) {
  const fmt = (v: number) => formaterVerdi ? formaterVerdi(v, yFormat) : v.toLocaleString('nb-NO', { maximumFractionDigits: 0 });
  const W = 800, H = 400, padL = 80, padR = 20, padT = 20, padB = 60;
  const vals   = data.map(r => Number(r[yCol]) || 0);
  const maxVal = Math.max(...vals, 1);
  const plotW  = W - padL - padR;
  const plotH  = H - padT - padB;
  const pts    = data.map((r, i) => ({
    x: padL + (i / Math.max(data.length-1,1)) * plotW,
    y: padT + plotH - (vals[i]/maxVal)*plotH,
    label: String(r[xCol] ?? ''),
  }));
  const polyline = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = pts.length
    ? `M${pts[0].x.toFixed(1)},${padT+plotH} ` + pts.map(p=>`L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ` L${pts[pts.length-1].x.toFixed(1)},${padT+plotH} Z`
    : '';
  const step = Math.max(1, Math.floor(pts.length/10));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <text x={14} y={padT + plotH / 2} fontSize={10} fill="var(--text-muted)" textAnchor="middle" transform={`rotate(-90,14,${padT + plotH / 2})`}>{yLabel}</text>
      {[0,.25,.5,.75,1].map(t => {
        const y = padT+plotH - t*plotH;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={padL+plotW} y2={y} stroke="var(--glass-bg-hover)"/>
            <text x={padL-6} y={y+4} fontSize={11} textAnchor="end" fill="var(--text-muted)">
              {fmt(t*maxVal)}
            </text>
          </g>
        );
      })}
      {area && <path d={areaPath} fill="var(--glass-gold-bg)"/>}
      <polyline points={polyline} fill="none" stroke="var(--gold)" strokeWidth={2}/>
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill="var(--gold)"/>
          {i%step===0 && <text x={p.x} y={padT+plotH+16} fontSize={10} textAnchor="middle" fill="var(--text-muted)">{p.label.slice(0,8)}</text>}
        </g>
      ))}
      <line x1={padL} y1={padT} x2={padL} y2={padT+plotH} stroke="var(--text-muted)"/>
      <line x1={padL} y1={padT+plotH} x2={padL+plotW} y2={padT+plotH} stroke="var(--text-muted)"/>
    </svg>
  );
}

// ── Kombinert chart (stolpe + linje, dual Y-akse) — recharts ─────────────────
const STOLPE_FARGER = ['var(--gold)', 'rgba(59,130,246,0.85)', 'rgba(16,185,129,0.85)', 'rgba(245,101,101,0.85)'];
const LINJE_FARGER  = ['rgba(110,231,183,0.9)', 'rgba(251,191,36,0.9)', 'rgba(167,139,250,0.9)', 'rgba(249,115,22,0.9)'];

function beregnKumulativ(
  data: Record<string, unknown>[],
  serier: KombinertSerie[],
): Record<string, unknown>[] {
  const kumulative = serier.filter(s => s.kumulativ);
  if (kumulative.length === 0) return data;
  const akkumulator: Record<string, number> = {};
  return data.map(rad => {
    const nyRad = { ...rad };
    for (const serie of kumulative) {
      const verdi = Number(rad[serie.navn] ?? 0);
      akkumulator[serie.navn] = (akkumulator[serie.navn] ?? 0) + verdi;
      nyRad[serie.navn] = akkumulator[serie.navn];
    }
    return nyRad;
  });
}

function KombinertChart({ data, xCol, stolpeKol, linjeKol, serier }: {
  data:      Record<string, unknown>[];
  xCol:      string;
  stolpeKol: string;
  linjeKol:  string;
  serier?:   KombinertSerie[];
}) {
  const harSerier    = serier && serier.length > 0;
  const stolpeSerier = serier?.filter(s => s.visningsType === 'stolpe') ?? [];
  const linjeSerier  = serier?.filter(s => s.visningsType === 'linje')  ?? [];
  const harLinjeAkse = harSerier ? linjeSerier.length > 0 : !!linjeKol;
  const behandletData = harSerier ? beregnKumulativ(data, serier ?? []) : data;

  const beregnDomain = (kolonner: string[]): [number, number] | ['auto', 'auto'] => {
    const verdier = behandletData.flatMap(d =>
      kolonner.map(k => Number(d[k])).filter(v => isFinite(v))
    );
    if (verdier.length === 0) return ['auto', 'auto'];
    const min = Math.min(...verdier);
    const max = Math.max(...verdier);
    const pad = Math.abs(max - min) * 0.1 || 1;
    return [min < 0 ? min - pad : 0, max >= 0 ? max + pad : 0];
  };

  const stolpeKolonner = harSerier ? stolpeSerier.map(s => s.navn) : [stolpeKol];
  const linjeKolonner  = harSerier ? linjeSerier.map(s => s.navn)  : [linjeKol];
  const stolpeDomain   = beregnDomain(stolpeKolonner);
  const linjeDomain    = beregnDomain(linjeKolonner);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <ComposedChart data={behandletData} margin={{ top: 10, right: 40, left: 10, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
        <XAxis
          dataKey={xCol}
          tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
          angle={-35}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          yAxisId="stolpe"
          orientation="left"
          domain={stolpeDomain}
          allowDataOverflow={true}
          tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
          tickFormatter={(v) => new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(v)}
        />
        {harLinjeAkse && (
          <YAxis
            yAxisId="linje"
            orientation="right"
            domain={linjeDomain}
            allowDataOverflow={true}
            tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
            tickFormatter={(v) => new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(v)}
          />
        )}
        <Tooltip
          contentStyle={{
            background: 'var(--navy-dark)',
            border: '1px solid var(--glass-border)',
            borderRadius: 8,
            color: 'var(--text-primary)',
            fontSize: 12,
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={((value: unknown, name: unknown) => {
            const navnStr = String(name ?? '');
            const erKumulativ = serier?.find(s => s.navn === navnStr)?.kumulativ ?? false;
            const formatertVerdi = typeof value === 'number'
              ? new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 2 }).format(value)
              : String(value ?? '');
            return [formatertVerdi, erKumulativ ? `${navnStr} (∑)` : navnStr];
          }) as any}
        />
        <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12, paddingTop: 16 }} />

        {harSerier ? (
          <>
            {stolpeSerier.map((s, i) => (
              <Bar
                key={s.id}
                yAxisId="stolpe"
                dataKey={s.navn}
                fill={STOLPE_FARGER[i % STOLPE_FARGER.length]}
                opacity={0.85}
                radius={[3, 3, 0, 0] as [number, number, number, number]}
                name={s.navn}
              />
            ))}
            {linjeSerier.map((s, i) => (
              <Line
                key={s.id}
                yAxisId="linje"
                type="monotone"
                dataKey={s.navn}
                stroke={LINJE_FARGER[i % LINJE_FARGER.length]}
                strokeWidth={2.5}
                dot={{ fill: LINJE_FARGER[i % LINJE_FARGER.length], r: 3 }}
                activeDot={{ r: 5 }}
                name={s.navn}
              />
            ))}
          </>
        ) : (
          <>
            <Bar
              yAxisId="stolpe"
              dataKey={stolpeKol}
              fill="var(--gold)"
              opacity={0.85}
              radius={[3, 3, 0, 0] as [number, number, number, number]}
              name={stolpeKol}
            />
            {linjeKol && (
              <Line
                yAxisId="linje"
                type="monotone"
                dataKey={linjeKol}
                stroke="rgba(110,231,183,0.9)"
                strokeWidth={2.5}
                dot={{ fill: 'rgba(110,231,183,0.9)', r: 3 }}
                activeDot={{ r: 5 }}
                name={linjeKol}
              />
            )}
          </>
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Pie chart ─────────────────────────────────────────────────────────────────
function PieChart({ data, xCol, yCol }: { data: Record<string,unknown>[]; xCol: string; yCol: string }) {
  const W = 500, H = 320, cx = 160, cy = 150, r = 120;
  const slices = data.slice(0,8).map(row => ({ label: String(row[xCol]??''), val: Math.abs(Number(row[yCol])||0) }));
  const total  = slices.reduce((s,x)=>s+x.val,0)||1;
  let cumAngle = -Math.PI/2;
  const paths = slices.map((s,i) => {
    const angle = (s.val/total)*2*Math.PI;
    const x1=cx+r*Math.cos(cumAngle), y1=cy+r*Math.sin(cumAngle);
    cumAngle += angle;
    const x2=cx+r*Math.cos(cumAngle), y2=cy+r*Math.sin(cumAngle);
    const large = angle>Math.PI?1:0;
    const mid   = cumAngle - angle/2;
    return (
      <g key={i}>
        <path d={`M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`}
          fill={COLORS[i%COLORS.length]} opacity={0.85}/>
        {angle>0.3 && <text x={cx+r*0.6*Math.cos(mid)} y={cy+r*0.6*Math.sin(mid)} fontSize={11} textAnchor="middle" fill="rgba(0,0,0,0.75)" fontWeight={600}>{((s.val/total)*100).toFixed(0)}%</text>}
      </g>
    );
  });
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', maxWidth: 500, margin: '0 auto' }}>
      {paths}
      {slices.map((s,i) => (
        <g key={i}>
          <rect x={W-160} y={20+i*24} width={12} height={12} fill={COLORS[i%COLORS.length]} rx={2}/>
          <text x={W-144} y={31+i*24} fontSize={12} fill="var(--text-secondary)">{s.label.slice(0,16)} ({((s.val/total)*100).toFixed(0)}%)</text>
        </g>
      ))}
    </svg>
  );
}

// ── Card (KPI) ────────────────────────────────────────────────────────────────
function CardChart({ data, yCol, yLabel }: { data: Record<string,unknown>[]; yCol: string; yLabel: string }) {
  const val = data[0]?.[yCol];
  const num = typeof val==='number' ? val : Number(val);
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:220 }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:64, fontWeight:800, color:'var(--gold)', fontFamily:'Barlow Condensed, sans-serif' }}>
          {isNaN(num) ? String(val??'-') : num.toLocaleString('nb-NO')}
        </div>
        <div style={{ fontSize:15, color:'var(--text-muted)', marginTop:10 }}>{yLabel}</div>
        <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:4 }}>{data.length} rader i datasettet</div>
      </div>
    </div>
  );
}

// ── Data table ────────────────────────────────────────────────────────────────
function DataTable({ data, visKolonner, alleViewKolonner }: {
  data: Record<string,unknown>[];
  visKolonner: string[];
  alleViewKolonner?: { kolonne_navn: string; kolonne_type: string }[];
}) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const cols  = visKolonner.length ? visKolonner : (data.length ? Object.keys(data[0]) : []);
  const total = data.length;
  const rows  = data.slice(page*pageSize, (page+1)*pageSize);

  const formaterVerdi = (verdi: unknown, kolonne: string): React.ReactNode => {
    if (verdi === null || verdi === undefined) return <span style={{color:'var(--text-muted)'}}>—</span>;
    const meta = alleViewKolonner?.find(k => k.kolonne_navn === kolonne);
    if (meta?.kolonne_type === 'measure') {
      const tall = Number(verdi);
      if (!isNaN(tall)) {
        return tall % 1 === 0
          ? tall.toLocaleString('nb-NO')
          : tall.toLocaleString('nb-NO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      }
    }
    return String(verdi);
  };

  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c} style={{ padding:'8px 12px', textAlign:'left', borderBottom:'1px solid var(--glass-border)', color:'var(--text-secondary)', fontWeight:600, fontSize:12, whiteSpace:'nowrap', fontFamily:'Barlow Condensed, sans-serif', letterSpacing:'0.05em' }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i%2===0?'transparent':'var(--glass-bg)' }}>
              {cols.map(c => (
                <td key={c} style={{ padding:'7px 12px', borderBottom:'1px solid var(--glass-bg)', color:'var(--text-primary)', whiteSpace:'nowrap' }}>
                  {formaterVerdi(row[c], c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {total>pageSize && (
        <div style={{ display:'flex', gap:8, alignItems:'center', padding:'12px 0', fontSize:12, color:'var(--text-muted)' }}>
          <button disabled={page===0} onClick={()=>setPage(p=>p-1)} style={{ padding:'4px 10px', borderRadius:6, background:'var(--glass-bg-hover)', border:'1px solid var(--glass-border)', color:'var(--text-secondary)', cursor:page===0?'default':'pointer' }}>Forrige</button>
          <span>Side {page+1} av {Math.ceil(total/pageSize)}</span>
          <button disabled={(page+1)*pageSize>=total} onClick={()=>setPage(p=>p+1)} style={{ padding:'4px 10px', borderRadius:6, background:'var(--glass-bg-hover)', border:'1px solid var(--glass-border)', color:'var(--text-secondary)', cursor:(page+1)*pageSize>=total?'default':'pointer' }}>Neste</button>
          <span style={{ marginLeft:8 }}>{total} rader totalt</span>
        </div>
      )}
    </div>
  );
}

// ── FilterVerdiInput ──────────────────────────────────────────────────────────
const fvInputStyle: React.CSSProperties = {
  width: '100%', fontSize: 11, padding: '4px 6px',
  background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
  color: 'var(--text-primary)', borderRadius: 5, outline: 'none',
};

interface FilterVerdiInputProps {
  kolonne:          string;
  operator:         string;
  verdi:            string;
  onChange:         (verdi: string) => void;
  viewNavn?:        string | null;
  prosjektFilter?:  string | null;
  kolonneTyper:     Record<string, string>;
  alleViewKolonner?: { kolonne_navn: string; kolonne_type: string; datatype?: string }[];
  onEnter?:         () => void;
  aktiveFiltre?:    AktivFilter[];
}

function FilterVerdiInput({
  kolonne, operator, verdi, onChange,
  viewNavn, prosjektFilter, kolonneTyper, alleViewKolonner, onEnter, aktiveFiltre,
}: FilterVerdiInputProps) {
  const [verdier,         setVerdier]         = useState<string[]>([]);
  const [laster,          setLaster]          = useState(false);
  const [harFlere,        setHarFlere]        = useState(false);
  const [lasterFlere,     setLasterFlere]     = useState(false);
  const [side,            setSide]            = useState(0);
  const [visSok,          setVisSok]          = useState(false);
  const [sok,             setSok]             = useState('');
  const [dropdownRetning, setDropdownRetning] = useState<'left' | 'right'>('left');
  const containerRef                          = useRef<HTMLDivElement>(null);

  // Bruk kolonne_type fra metadata (alleViewKolonner) som autoritativ kilde.
  // Faller tilbake til kolonneTyper (som også er metadata-basert om API fungerer).
  const kolonneMeta = alleViewKolonner?.find(k => k.kolonne_navn === kolonne);
  const type        = kolonneMeta?.kolonne_type ?? kolonneTyper[kolonne] ?? 'dimensjon';
  const erDato      = type === 'dato';
  const erMeasure   = type === 'measure'; // kun eksplisitte measures → tall-input
  const erTekst     = !erDato && !erMeasure; // dimensjon, id og ukjente → dropdown

  console.log('[FilterVerdi] kolonne:', kolonne, '| type:', type, '| datatype:', kolonneMeta?.datatype ?? '?', '| erTekst:', erTekst);

  // Hent verdier med lazy-loading-støtte (offset-basert paginering)
  const hentVerdier = useCallback(async (offset: number, reset: boolean) => {
    if (!erTekst || !kolonne || !viewNavn) return;
    if (offset === 0) setLaster(true); else setLasterFlere(true);

    const params = new URLSearchParams({ viewNavn, kolonne, limit: '200', offset: String(offset) });
    if (prosjektFilter) params.set('prosjektFilter', prosjektFilter);
    const andreFiltre = (aktiveFiltre ?? []).filter(f => f.kolonne && f.verdi && f.kolonne !== kolonne);
    if (andreFiltre.length > 0) params.set('kaskadefiltere', JSON.stringify(andreFiltre));

    try {
      const r = await apiFetch(`/api/rapport-designer/kolonneverdier?${params.toString()}`, { credentials: 'include' });
      if (!r.ok) { if (reset) setVerdier([]); return; }
      const d = await r.json() as { verdier: unknown[] };
      const nyeVerdier = (d.verdier ?? []).map(String);
      if (reset) setVerdier(nyeVerdier); else setVerdier(prev => [...prev, ...nyeVerdier]);
      setHarFlere(nyeVerdier.length === 200);
      setSide(Math.floor(offset / 200) + 1);
    } catch (err) {
      console.error('[FilterVerdi] fetch feil:', err);
      if (reset) setVerdier([]);
    } finally {
      if (offset === 0) setLaster(false); else setLasterFlere(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erTekst, kolonne, viewNavn, prosjektFilter, JSON.stringify(aktiveFiltre)]);

  // Initial last ved endring av kolonne, view, operator eller aktive filtre
  useEffect(() => {
    if (!erTekst || !kolonne || !viewNavn) { setVerdier([]); return; }
    if (operator === 'LIKE' || operator === 'NOT LIKE' || operator === 'BETWEEN') { setVerdier([]); return; }
    setSide(0);
    setHarFlere(false);
    void hentVerdier(0, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kolonne, viewNavn, erTekst, operator, JSON.stringify(aktiveFiltre)]);

  // Lukk dropdown ved klikk utenfor
  useEffect(() => {
    if (!visSok) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setVisSok(false);
        setSok('');
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 100);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [visSok]);

  // Sjekk om dropdown går utenfor høyre kant — åpne mot venstre i så fall
  useEffect(() => {
    if (!visSok || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownRetning(rect.left + 280 > window.innerWidth ? 'right' : 'left');
  }, [visSok]);

  const filtrerte = verdier.filter(v => v.toLowerCase().includes(sok.toLowerCase()));

  // LIKE/NOT LIKE/BETWEEN → fritekst (BETWEEN håndteres med to felt i call-site, men andre felt bruker dette)
  if (operator === 'LIKE' || operator === 'NOT LIKE' || operator === 'BETWEEN') {
    return (
      <input type="text" value={verdi} onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onEnter?.(); }}
        placeholder={operator === 'BETWEEN' ? 'Fra...' : 'søketekst...'} style={{ ...fvInputStyle, flex: 1 }} />
    );
  }

  // Dato
  if (erDato) {
    return (
      <input type="date" value={verdi} onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onEnter?.(); }}
        style={{ ...fvInputStyle, flex: 1 }} />
    );
  }

  // Tall (measure/id)
  if (erMeasure) {
    return (
      <input type="number" value={verdi} onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onEnter?.(); }}
        placeholder="tall..." style={{ ...fvInputStyle, flex: 1 }} />
    );
  }

  // Tekst med oppslags-dropdown
  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <div onClick={() => setVisSok(v => !v)} style={{
        ...fvInputStyle, cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', userSelect: 'none',
      }}>
        <span style={{
          color: verdi ? 'var(--text-primary)' : 'var(--text-muted)',
          fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {verdi || (laster ? 'Laster...' : 'Velg verdi...')}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0, marginLeft: 4 }}>
          {visSok ? '▲' : '▼'}
        </span>
      </div>

      {visSok && (
        <div style={{
          position: 'absolute', top: '100%',
          ...(dropdownRetning === 'right' ? { right: 0 } : { left: 0 }),
          minWidth: 220, width: 'max-content', maxWidth: 320,
          background: '#0f1c30', border: '1px solid var(--gold-dim)',
          borderRadius: 6, zIndex: 1000, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>
          <div style={{ padding: 6 }}>
            <input type="text" value={sok} onChange={e => setSok(e.target.value)}
              placeholder="Søk..." autoFocus
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', background: 'var(--glass-bg-hover)',
                border: '1px solid var(--glass-border-hover)', borderRadius: 4,
                padding: '4px 8px', color: 'var(--text-primary)',
                fontSize: 11, outline: 'none', boxSizing: 'border-box',
              }} />
          </div>
          <div
            style={{ maxHeight: 180, overflowY: 'auto' }}
            onScroll={e => {
              const el = e.currentTarget;
              const nærBunn = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
              if (nærBunn && harFlere && !lasterFlere) {
                void hentVerdier(side * 200, false);
              }
            }}
          >
            <div onClick={() => { onChange(''); setVisSok(false); setSok(''); }}
              style={{
                padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)',
                cursor: 'pointer', borderBottom: '1px solid var(--glass-bg)',
                fontStyle: 'italic',
              }}>
              — Ingen verdi —
            </div>
            {filtrerte.length === 0 && (
              <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                {laster ? 'Laster verdier...' : 'Ingen treff'}
              </div>
            )}
            {filtrerte.map((v, i) => (
              <div key={i} onClick={() => { onChange(v); setVisSok(false); setSok(''); }}
                style={{
                  padding: '6px 10px', fontSize: 11, cursor: 'pointer',
                  color: v === verdi ? 'var(--gold)' : 'var(--text-secondary)',
                  background: v === verdi ? 'var(--gold-dim)' : 'transparent',
                  borderBottom: '1px solid var(--glass-bg)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { if (v !== verdi) (e.currentTarget as HTMLDivElement).style.background = 'var(--glass-bg)'; }}
                onMouseLeave={e => { if (v !== verdi) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                {v}
              </div>
            ))}
            {lasterFlere && (
              <div style={{
                padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)',
                textAlign: 'center', borderTop: '1px solid var(--glass-bg)',
              }}>
                Laster flere...
              </div>
            )}
          </div>
          {verdier.length > 0 && (
            <div style={{
              padding: '4px 10px', fontSize: 10, color: 'var(--text-muted)',
              borderTop: '1px solid var(--glass-bg)', textAlign: 'right',
            }}>
              {filtrerte.length} av {verdier.length}{harFlere ? '+' : ''} verdier
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RapportInteraktivPage() {
  const router = useRouter();
  const { entraObjectId, authHeaders } = usePortalAuth();
  const [forslag,    setForslag]    = useState<RapportForslag | null>(null);
  const [config,     setConfig]     = useState<RedigertConfig | null>(null);
  const [aktivData,  setAktivData]  = useState<Record<string, unknown>[]>([]);
  const [lasterData, setLasterData] = useState(false);
  const [tilgjengeligeKolonner, setTilgjengeligeKolonner] = useState<string[]>([]);
  const [viewKolonner, setViewKolonner] = useState<string[]>([]);
  const [kolonnTyper, setKolonnTyper] = useState<Record<string, string>>({});
  const [kpiUttrykk,      setKpiUttrykk]      = useState<Record<string, string>>({});
  const [kpiFormat,       setKpiFormat]       = useState<Record<string, string>>({});
  const [kpiVisningsnavn, setKpiVisningsnavn] = useState<Record<string, string>>({});
  const [visTabell,          setVisTabell]          = useState(false);
  const [visRediger,         setVisRediger]         = useState(false);
  const [eksporterer,        setEksporterer]        = useState(false);
  const [autoRefresh,        setAutoRefresh]        = useState(true);
  const [ventendePåRefresh,  setVentendePåRefresh]  = useState(false);
  const [storViewAdvarsel,   setStorViewAdvarsel]   = useState(false);
  const [queryFeil,          setQueryFeil]          = useState<string | null>(null);
  const [lagrer,       setLagrer]       = useState(false);
  const [lagret,       setLagret]       = useState(false);
  const [eksisterendeRapportId, setEksisterendeRapportId] = useState<string | null>(null);
  const [filterCol,      setFilterCol]      = useState('');
  const [filterVal,      setFilterVal]      = useState('');
  const [aktiveFiltre,     setAktiveFiltre]     = useState<AktivFilter[]>([]);
  // Valgte kolonner for tabell-visning (styres av checkbox-panelet)
  const [valgteKolonner,   setValgteKolonner]   = useState<string[]>([]);

  // Track initial mount to avoid double-fetch on load
  // Keep configRef current on every render (prevents stale closure in effects/timeouts)
  const isFirstFetch = useRef(true);
  // Debounce timer for SQL fetch
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flag: skal auto-hente data etter at kolonner er lastet (ny rapport-flyt)
  const nyRapportAutoFetch = useRef(false);
  // fraRapportId fra URL-params — brukes ved lagring for server-side prosjektNr-validering
  const fraRapportIdRef = useRef<string | null>(null);
  // Guard mot dobbel-kjøring av initialiserDesigner (React StrictMode / Next.js)
  const harInitialisert = useRef(false);
  // Blokkerer hentData til initialiserDesigner er helt ferdig
  const initialiseringFerdig = useRef(false);
  // Synkrone refs for prosjektfilter-verdier — omgår React state-asynkronitet i hentData
  const prosjektNrRef          = useRef<string | null>(null);
  const prosjektKolonneRef     = useRef<string | null>(null);
  const prosjektKolonneTypeRef = useRef<string>('number');
  const viewNavnRef            = useRef<string | null>(null);
  // Alltid oppdatert ref til config — brukes i useEffect/setTimeout for å unngå stale closure
  const configRef              = useRef<RedigertConfig | null>(null);
  const valgteKolonnerRef      = useRef<string[]>([]);
  const kolonnTyperRef         = useRef<Record<string, string>>({});
  const kpiUtrykkRef           = useRef<Record<string, string>>({});
  configRef.current        = config;        // synkroniser på hver render
  valgteKolonnerRef.current  = valgteKolonner;
  kolonnTyperRef.current     = kolonnTyper;
  kpiUtrykkRef.current       = kpiUttrykk;

  useEffect(() => {
    try {
      // Ny rapport-sesjon (URL-params) eller fraLagret — ikke last gammel sessionStorage
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('viewNavn') || urlParams.get('fraLagret') === 'true') {
        sessionStorage.removeItem('rapport_forslag');
        return;
      }
      const raw = sessionStorage.getItem('rapport_forslag');
      if (!raw) return;
      let f = JSON.parse(raw) as RapportForslag;
      // Gjenoppbygg låst prosjektfilter fra laastFilter hvis det finnes
      if (f.laastFilter?.kolonne && f.laastFilter?.verdi) {
        f = { ...f, prosjektKolonne: f.laastFilter.kolonne, prosjektNr: f.laastFilter.verdi };
      }
      setForslag(f);
      setAktivData(f.data ?? []);

      const dataCols = f.data?.[0] ? Object.keys(f.data[0]) : [];
      const xAkse = f.xAkse ?? dataCols[0] ?? '';
      const yAkse = f.yAkse ?? dataCols[1] ?? dataCols[0] ?? '';

      setConfig({
        visualType: f.visualType, xAkse, yAkse,
        aggregering: 'SUM',
        grupperPaa: f.grupperPaa ?? null,
        ekstraKolonner: [], kombinertSerier: [], sorterPaa: null, sorterRetning: defaultSorterRetning(xAkse), maksRader: 50,
      });

      {
        const parsed = parseFiltreTilObjekter(f.sql ?? '', f.prosjektFilter ?? '', f.prosjektKolonne);
        const gyldigeKol = new Set((f.alleViewKolonner ?? []).map(k => k.kolonne_navn.toLowerCase()));
        setAktiveFiltre(gyldigeKol.size > 0 ? parsed.filter(ff => gyldigeKol.has(ff.kolonne.toLowerCase())) : parsed);
      }

      // sessionStorage-path: sett refs og marker initialisering som ferdig
      viewNavnRef.current            = f.viewNavn ?? null;
      prosjektNrRef.current          = f.prosjektNr ?? null;
      prosjektKolonneRef.current     = f.prosjektKolonne ?? null;
      prosjektKolonneTypeRef.current = f.prosjektKolonneType ?? 'number';
      initialiseringFerdig.current   = true;

      // Hvis data mangler (lastet fra lagret rapport), tillat auto-fetch
      if (!f.data?.length) {
        isFirstFetch.current = false;
      }

      if (f.alleViewKolonner?.length) {
        const navnListe = f.alleViewKolonner.map(k => k.kolonne_navn);
        setTilgjengeligeKolonner(navnListe);
        const typemap: Record<string, string> = {};
        const kpiMap: Record<string, string> = {};
        const fmtMap: Record<string, string> = {};
        const vnsMap: Record<string, string> = {};
        for (const k of f.alleViewKolonner) {
          typemap[k.kolonne_navn] = k.kolonne_type;
          if (k.kolonne_type === 'kpi' && k.sql_uttrykk) {
            kpiMap[k.kolonne_navn] = k.sql_uttrykk;
            if (k.format)       fmtMap[k.kolonne_navn] = k.format;
            if (k.visningsnavn) vnsMap[k.kolonne_navn] = k.visningsnavn;
          }
        }
        setKolonnTyper(typemap);
        setKpiUttrykk(kpiMap);
        setKpiFormat(fmtMap);
        setKpiVisningsnavn(vnsMap);
      } else {
        setTilgjengeligeKolonner(dataCols);
        if (f.viewNavn) {
          apiFetch(`/api/pbi/view-kolonner?viewNavn=${encodeURIComponent(f.viewNavn)}`)
            .then(r => r.ok ? r.json() as Promise<{ kolonner: string[] }> : null)
            .then(d => { if (d?.kolonner?.length) setTilgjengeligeKolonner(d.kolonner); })
            .catch(() => {});
        }
      }
    } catch { /* ignore */ }
  }, []);

  // ── Debug: log forslag og config ved endring ──
  useEffect(() => {
    console.log('[Designer] forslag oppdatert:', {
      viewNavn: forslag?.viewNavn,
      prosjektNr: forslag?.prosjektNr,
      prosjektKolonne: forslag?.prosjektKolonne,
      prosjektFilter: forslag?.prosjektFilter,
      alleViewKolonnerAntall: forslag?.alleViewKolonner?.length,
    });
  }, [forslag]);

  // ── Sett filtre fra forslag.sql når SQL ankommer eller endres ──
  // Dekker alle paths: sessionStorage, fraLagret og URL-params.
  // Alle SQL-filtre er redigerbare (erLåst = false).
  useEffect(() => {
    if (!forslag?.sql) return;
    const parsed = parseFiltreTilObjekter(forslag.sql, forslag.prosjektFilter ?? '', forslag.prosjektKolonne);
    if (parsed.length === 0) return;
    console.log('[filtre fra SQL] setter', parsed.length, 'filtre:', parsed.map(f => f.kolonne));
    setAktiveFiltre(parsed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forslag?.sql]);

  useEffect(() => {
    console.log('[Designer] config oppdatert:', {
      xAkse: config?.xAkse,
      yAkse: config?.yAkse,
      aggregering: config?.aggregering,
    });
  }, [config]);

  // ── Hent alle viewkolonner fra metadata når forslag.viewNavn endres ──
  useEffect(() => {
    const vn = forslag?.viewNavn;
    if (!vn) return; // vent til viewNavn er satt

    apiFetch('/api/admin/metadata/views', { credentials: 'include', headers: authHeaders })
      .then(r => r.json())
      .then((res: unknown) => {
        // API kan returnere ren array eller { views: [...] } / { data: [...] }
        const views: { view_name: string; schema_name: string; kolonner?: { kolonne_navn: string }[]; kpi?: { navn: string }[] }[] =
          Array.isArray(res) ? res
          : Array.isArray((res as Record<string, unknown>).views) ? (res as Record<string, unknown[]>).views as typeof views
          : Array.isArray((res as Record<string, unknown>).data)  ? (res as Record<string, unknown[]>).data  as typeof views
          : [];
        // Bruk lokalt fanget vn — ikke forslag.viewNavn via closure (kan ha endret seg)
        const view = views.find(v =>
          v.view_name === vn ||
          `${v.schema_name}.${v.view_name}` === vn ||
          vn.includes(v.view_name)
        );
        if (view) {
          const kolonner = view.kolonner?.map(k => k.kolonne_navn) ?? [];
          const kpier = view.kpi?.map(k => k.navn) ?? [];
          setViewKolonner([...kolonner, ...kpier]);
          console.log('[viewKolonner] lastet:', kolonner.length, 'kolonner +', kpier.length, 'KPI-er for', vn);
        } else {
          console.warn('[viewKolonner] fant ikke view:', vn, 'blant', views.map(v => v.view_name));
        }
      })
      .catch(e => console.error('[viewKolonner] feil:', e));
  // authHeaders er memoized i usePortalAuth — ny referanse kun når entraObjectId faktisk endres
  }, [forslag?.viewNavn, authHeaders]);

  // ── Sekvensielt initialiser fra URL-parametre (Ny rapport-wizard → rapport-interaktiv) ──
  useEffect(() => {
    async function initialiserDesigner() {
      console.log('[init] starter initialiserDesigner | harInitialisert:', harInitialisert.current);
      const urlParams = new URLSearchParams(window.location.search);

      // Logg ALLE query-params for diagnostikk
      console.log('[init] ALLE query-params:');
      urlParams.forEach((value, key) => { console.log(`  ${key} = ${value}`); });

      const viewNavn = urlParams.get('viewNavn');
      if (!viewNavn) { console.error('[Designer] viewNavn mangler i URL!'); return; }

      // Nullstill alltid config ved ny sesjon — forhindrer at forrige rapport sine kolonner lever videre
      sessionStorage.removeItem('rapport_forslag');
      setConfig({ visualType: 'bar', xAkse: '', yAkse: '', aggregering: 'SUM', grupperPaa: null, ekstraKolonner: [], kombinertSerier: [], sorterPaa: null, sorterRetning: defaultSorterRetning(''), maksRader: 50 });
      setAktivData([]);
      setAktiveFiltre([]);

      const tittel              = urlParams.get('tittel') ?? `Ny rapport – ${urlParams.get('visningsnavn') ?? viewNavn}`;
      const beskrivelse         = urlParams.get('beskrivelse') ?? '';
      const prosjektNr          = urlParams.get('prosjektNr');
      const prosjektKolonne     = urlParams.get('prosjektKolonne');
      const prosjektKolonneType = urlParams.get('prosjektKolonneType') ?? 'number';
      fraRapportIdRef.current   = urlParams.get('fraRapportId');

      // Sett refs SYNKRONT FØR første await — disse leses av hentData uten closure-problemer
      viewNavnRef.current            = viewNavn;
      prosjektNrRef.current          = prosjektNr;
      prosjektKolonneRef.current     = prosjektKolonne;
      prosjektKolonneTypeRef.current = prosjektKolonneType;

      console.log('[init] refs satt synkront:', {
        prosjektNr:      prosjektNrRef.current,
        prosjektKolonne: prosjektKolonneRef.current,
        viewNavn:        viewNavnRef.current,
      });

      // Steg 1: Bygg prosjektfilter
      let prosjektFilter = '';
      if (prosjektKolonne && prosjektNr) {
        const verdi = prosjektKolonneType === 'number' ? prosjektNr : `'${prosjektNr}'`;
        prosjektFilter = `WHERE [${prosjektKolonne}] = ${verdi}`;
        console.log('[Designer] prosjektFilter:', prosjektFilter);
      } else {
        console.warn('[Designer] INGEN prosjektfilter — prosjektKolonne:', prosjektKolonne, '| prosjektNr:', prosjektNr);
      }

      // Steg 2: Hent kolonner FØR state settes — lokale variabler kun
      let alleKolonner: { kolonne_navn: string; kolonne_type: string; sql_uttrykk?: string; format?: string; visningsnavn?: string }[] = [];
      console.log('[Designer] henter kolonner for viewNavn:', viewNavn);
      try {
        const r = await apiFetch(
          `/api/rapport-designer/view-kolonner?viewNavn=${encodeURIComponent(viewNavn)}`,
          { credentials: 'include' },
        );
        console.log('[Designer] kolonner API status:', r.status);
        if (r.ok) {
          const d = await r.json() as { kolonner: { kolonne_navn: string; kolonne_type: string; sql_uttrykk?: string; format?: string; visningsnavn?: string }[]; kilde: string };
          alleKolonner = d.kolonner ?? [];
          console.log('[Designer] kolonner kilde:', d.kilde, '| antall:', alleKolonner.length);
          console.log('[Designer] measures:', alleKolonner.filter(k => k.kolonne_type === 'measure').map(k => k.kolonne_navn));
          console.log('[Designer] dimensjoner:', alleKolonner.filter(k => k.kolonne_type === 'dimensjon').map(k => k.kolonne_navn));
        } else {
          const errText = await r.text();
          console.error('[Designer] kolonner API feil:', r.status, errText);
        }
      } catch (err) {
        console.error('[Designer] kolonner fetch-feil:', err);
      }

      // Steg 3: Finn xAkse/yAkse fra kolonnetyper (lokale variabler)
      const alleKolonnerMedDatatype = alleKolonner as (typeof alleKolonner[0] & { datatype?: string })[];
      console.log('[Designer] alle kolonnetyper:', alleKolonnerMedDatatype.map(k => `${k.kolonne_navn}:${k.kolonne_type}(${k.datatype ?? '?'})`).join(', '));
      const xAkse = alleKolonner.find(k => k.kolonne_type === 'dimensjon')?.kolonne_navn ?? '';
      const numericDatatypes = ['int','bigint','decimal','float','numeric','money','smallmoney','smallint','tinyint','real'];
      const yAkse = alleKolonner.find(k => k.kolonne_type === 'measure')?.kolonne_navn
        ?? alleKolonnerMedDatatype.find(k => numericDatatypes.includes((k.datatype ?? '').toLowerCase()))?.kolonne_navn
        ?? '';
      console.log('[Designer] valgte kolonner:', { xAkse, yAkse });

      if (!xAkse || !yAkse) {
        console.error('[Designer] KRITISK: mangler kolonner — kan ikke hente data');
      }

      const typemap: Record<string, string> = {};
      const kpiMap: Record<string, string> = {};
      const fmtMap: Record<string, string> = {};
      const vnsMap: Record<string, string> = {};
      for (const k of alleKolonner) {
        typemap[k.kolonne_navn] = k.kolonne_type;
        if (k.kolonne_type === 'kpi' && k.sql_uttrykk) {
          kpiMap[k.kolonne_navn] = k.sql_uttrykk;
          if (k.format)       fmtMap[k.kolonne_navn] = k.format;
          if (k.visningsnavn) vnsMap[k.kolonne_navn] = k.visningsnavn;
        }
      }

      // Steg 4: Sett ALT state på én gang — kolonner, config og forslag er klare
      const nyttForslag: RapportForslag = {
        tittel, beskrivelse,
        viewNavn, visualType: 'bar',
        xAkse, yAkse,
        sql: prosjektFilter
          ? `SELECT TOP 100 * FROM ${viewNavn} ${prosjektFilter}`
          : `SELECT TOP 100 * FROM ${viewNavn}`,
        data: [],
        alleViewKolonner: alleKolonner,
        prosjektNr:          prosjektNr ?? null,
        prosjektNavn:        null,
        prosjektKolonne:     prosjektKolonne ?? null,
        prosjektKolonneType: prosjektKolonneType,
        prosjektFilter:      prosjektFilter || null,
      };

      const nyConfig: RedigertConfig = {
        visualType: 'bar', xAkse, yAkse,
        aggregering: 'SUM', grupperPaa: null,
        ekstraKolonner: [], kombinertSerier: [], sorterPaa: null, sorterRetning: defaultSorterRetning(xAkse), maksRader: 50,
      };

      nyRapportAutoFetch.current = true; // Bloker debounced effect under init
      isFirstFetch.current       = true;
      setForslag(nyttForslag);
      setConfig(nyConfig);
      setTilgjengeligeKolonner(alleKolonner.map(k => k.kolonne_navn));
      setKolonnTyper(typemap);
      setKpiUttrykk(kpiMap);
      setKpiFormat(fmtMap);
      setKpiVisningsnavn(vnsMap);

      // Deaktiver auto-refresh automatisk for sannsynlig store views
      const erSannsynligStortView = viewNavn?.toLowerCase().includes('fact') ||
                                    viewNavn?.toLowerCase().includes('trans');
      if (erSannsynligStortView) {
        setAutoRefresh(false);
        setStorViewAdvarsel(true);
        setTimeout(() => setStorViewAdvarsel(false), 6000);
      }

      // Steg 5: Hent data med lokale variabler — omgår stale closure helt
      if (xAkse && yAkse) {
        // Bygg WHERE-klausul korrekt: kombiner prosjektfilter og IS NOT NULL
        const filterDeler: string[] = [];
        if (prosjektFilter) filterDeler.push(prosjektFilter.replace(/^\s*WHERE\s+/i, '').trim());
        filterDeler.push(`[${xAkse}] IS NOT NULL`);
        const whereKlausul = `WHERE ${filterDeler.join(' AND ')}`;
        // KPI-kolonner: injiser sql_uttrykk direkte — de finnes ikke som fysiske kolonner
        const yUttrykk = kpiMap[yAkse]
          ? `${kpiMap[yAkse]} AS [${yAkse}]`
          : `SUM([${yAkse}]) AS [${yAkse}]`;
        // Kronologisk sortering for månedsnavn
        const erMånedInitial = ['månedsnavn', 'månednavn'].includes(xAkse.toLowerCase());
        const initialGroupBy = erMånedInitial ? `GROUP BY [${xAkse}], [måned]` : `GROUP BY [${xAkse}]`;
        const initialOrder   = erMånedInitial ? `ORDER BY [måned] ASC` : `ORDER BY ${kpiMap[yAkse] ?? `SUM([${yAkse}])`} DESC`;
        const sql = `SELECT TOP 50 [${xAkse}], ${yUttrykk} FROM ${viewNavn} ${whereKlausul} ${initialGroupBy} ${initialOrder}`;
        console.log('[Designer] initial SQL:', sql);
        setLasterData(true);
        try {
          const res = await apiFetch('/api/pbi/query-sql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql }),
          });
          console.log('[Designer] data API status:', res.status);
          if (res.ok) {
            const d = await res.json() as { rows: Record<string, unknown>[] };
            setAktivData(d.rows ?? []);
            setForslag(prev => prev ? { ...prev, data: d.rows ?? [] } : prev);
            console.log('[Designer] data lastet:', d.rows?.length, 'rader');
          } else {
            const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}`, detail: '' })) as { error?: string; detail?: string };
            const melding = errBody.detail || errBody.error || `HTTP ${res.status}`;
            console.error('[Designer] data API feil:', res.status, melding);
            setQueryFeil(melding);
          }
        } catch (err) {
          console.error('[Designer] initial datahenting feil:', err);
        } finally {
          setLasterData(false);
          nyRapportAutoFetch.current = false;
          isFirstFetch.current = false;
          // Forsink aktivering slik at effects trigget av init state-endringer
          // rekker å kjøre og blokkeres FØR flagget settes
          setTimeout(() => {
            initialiseringFerdig.current = true;
            console.log('[Designer] initialisering ferdig, hentData aktivert');
          }, 200);
        }
      } else {
        nyRapportAutoFetch.current = false;
        isFirstFetch.current = false;
        setTimeout(() => { initialiseringFerdig.current = true; }, 200);
      }
    }

    console.log('[init] useEffect kjører | harInitialisert:', harInitialisert.current);
    if (harInitialisert.current) {
      console.log('[init] allerede initialisert, skipper');
      return;
    }
    // fraLagret-path: håndteres av eget useEffect som venter på entraObjectId
    if (new URLSearchParams(window.location.search).get('fraLagret') === 'true') {
      console.log('[init] fraLagret=true — skippes her, håndteres av fraLagret-effect');
      return () => { harInitialisert.current = false; };
    }
    harInitialisert.current = true;
    void initialiserDesigner();
    // Cleanup: tilbakestill flag slik at StrictMode-remount kan kjøre initialiserDesigner på nytt
    return () => { harInitialisert.current = false; };
  }, []);

  // ── Direkte fetch med eksplisitt config (brukes av xAkse onChange og reset) ──
  const hentData = useCallback(async (cfg: RedigertConfig, overstyrFiltre?: AktivFilter[], overstyrKolonner?: string[]) => {
    setVentendePåRefresh(false);
    if (!initialiseringFerdig.current) {
      console.log('[hentData] blokkert — initialisering pågår');
      return;
    }
    // Tabell-modus trenger ikke xAkse/yAkse — den bruker valgteKolonner
    const harTabellKolonner = cfg.visualType === 'table' && (overstyrKolonner ?? valgteKolonnerRef.current).length > 0;
    if (!harTabellKolonner && (!cfg.xAkse || !cfg.yAkse)) {
      console.log('[hentData] blokkert — mangler kolonner:', { xAkse: cfg.xAkse, yAkse: cfg.yAkse });
      return;
    }
    // Les direkte fra URL-params (primær) med refs som fallback — begge er synkrone og closure-frie
    const live = new URLSearchParams(window.location.search);
    const pNr  = live.get('prosjektNr')      ?? prosjektNrRef.current;
    const pKol = live.get('prosjektKolonne') ?? prosjektKolonneRef.current;
    const vn   = live.get('viewNavn')        ?? viewNavnRef.current ?? forslag?.viewNavn ?? null;
    if (!vn) { console.error('[hentData] viewNavn mangler!'); return; }

    console.log('[hentData] fra searchParams+refs:', { pNr, pKol, viewNavn: vn });
    if (pKol && !pNr) console.error('[hentData] FEIL: prosjektKolonne satt men prosjektNr mangler!');

    setLasterData(true);
    setQueryFeil(null);
    try {
      const filtre = overstyrFiltre ?? aktiveFiltre;
      // byggWhereKlausul prioriterer pKol+pNr over prosjektFilter-streng
      // Legg alltid til IS NOT NULL for xAkse i bar/pie-modus for å unngå null-kategorier og lette server-lasten
      const xAkseFilter: AktivFilter[] =
        cfg.visualType !== 'table' && cfg.xAkse && !pKol && !pNr && filtre.length === 0
          ? [{ kolonne: cfg.xAkse, operator: 'IS NOT NULL', verdi: '' }]
          : [];
      const where = byggWhereKlausul(null, [...xAkseFilter, ...filtre], pKol, pNr, forslag?.alleViewKolonner);

      let sql: string;
      if (cfg.visualType === 'table') {
        const alleKolMeta = forslag?.alleViewKolonner ?? [];
        const valgteKol   = overstyrKolonner ?? valgteKolonnerRef.current;
        console.log('[hentData] tabell-modus | valgte kolonner:', valgteKol.join(', '));

        // Slå opp type fra metadata, fall tilbake på kolonnTyper-ref (alltid oppdatert)
        const getType = (k: string) => alleKolMeta.find(m => m.kolonne_navn === k)?.kolonne_type ?? kolonnTyperRef.current[k] ?? 'dimensjon';
        const valgteKpiKol      = valgteKol.filter(k => getType(k) === 'kpi');
        const valgteDimensjoner = valgteKol.filter(k => getType(k) !== 'measure' && getType(k) !== 'kpi');
        const valgteMeasures    = valgteKol.filter(k => getType(k) === 'measure');
        console.log('[TabellSQL] dimensjoner i GROUP BY:', valgteDimensjoner);
        console.log('[TabellSQL] measures med SUM:', valgteMeasures);
        console.log('[TabellSQL] KPI-kolonner:', valgteKpiKol);

        const selectListe = [
          ...valgteDimensjoner.map(k => `[${k}]`),
          ...valgteMeasures.map(k => `SUM([${k}]) AS [${k}]`),
          ...valgteKpiKol.map(k => `${kpiUtrykkRef.current[k] ?? `SUM([${k}])`} AS [${k}]`),
        ].join(',\n  ');
        const groupBy = valgteDimensjoner.length > 0 ? `GROUP BY ${valgteDimensjoner.map(k => `[${k}]`).join(', ')}` : '';
        const firstMeasure = valgteMeasures[0] ?? valgteKpiKol[0];
        const orderBy = valgteMeasures.length > 0
          ? `ORDER BY SUM([${valgteMeasures[0]}]) DESC`
          : valgteKpiKol.length > 0
            ? `ORDER BY ${kpiUtrykkRef.current[firstMeasure] ?? `SUM([${firstMeasure}])`} DESC`
            : valgteDimensjoner.length > 0 ? `ORDER BY [${valgteDimensjoner[0]}] ASC` : '';

        sql = `SELECT TOP ${cfg.maksRader} ${selectListe} FROM ${vn} ${where} ${groupBy} ${orderBy}`.replace(/\s+/g, ' ').trim();
      } else if (forslag?.sql) {
        // Bruk original AI-SQL som base — bevarer alle WHERE-betingelser (BETWEEN, Kontonr, etc.)
        // Erstatt ORDER BY og sørg for at sorteringskolonne finnes i GROUP BY og SELECT.
        const tallKolonner = new Set(['måned', 'år', 'årmåned', 'åruke', 'kontonr']);
        const råKol = cfg.sorterPaa ?? cfg.xAkse;
        // månedsnavn sorteres via [måned] (INT) — ikke alfabetisk på navnekolonnen
        const sorterKol = (råKol?.toLowerCase() === 'månedsnavn' || råKol?.toLowerCase() === 'månednavn')
          ? 'måned'
          : råKol;

        let baseUtenOrder = forslag.sql.replace(/\s+ORDER\s+BY\s+[\s\S]*$/i, '').trim();

        // Legg til sorteringskolonne i GROUP BY (og SELECT) hvis den mangler.
        // Azure SQL krever at ORDER BY-kolonner er i SELECT/GROUP BY.
        if (sorterKol && /GROUP\s+BY/i.test(baseUtenOrder)) {
          // Sjekk om kolonnen allerede finnes — match [kolonne] eller bare kolonnenavn
          const kolInneholdt = new RegExp(
            `GROUP\\s+BY[\\s\\S]*(?:\\[${sorterKol}\\]|(?<![\\wæøåÆØÅ])${sorterKol}(?![\\wæøåÆØÅ]))`, 'i'
          ).test(baseUtenOrder);

          if (!kolInneholdt) {
            // Legg til i GROUP BY
            baseUtenOrder = baseUtenOrder.replace(
              /GROUP\s+BY\s+([\s\S]*?)(\s*$)/i,
              (_, cols) => `GROUP BY ${cols.trim()}, [${sorterKol}]`,
            );
            // Legg til i SELECT hvis den heller ikke er der
            const kolISelect = new RegExp(
              `SELECT\\s+TOP\\s+\\d+[\\s\\S]*?(?:\\[${sorterKol}\\]|(?<![\\wæøåÆØÅ])${sorterKol}(?![\\wæøåÆØÅ]))`, 'i'
            ).test(baseUtenOrder);
            if (!kolISelect) {
              baseUtenOrder = baseUtenOrder.replace(
                /^(SELECT\s+TOP\s+\d+)\s+/i,
                (_, prefix) => `${prefix} [${sorterKol}], `,
              );
            }
          }
        }

        const orderByStr = sorterKol
          ? (tallKolonner.has(sorterKol.toLowerCase())
              ? `ORDER BY CAST([${sorterKol}] AS INT) ${cfg.sorterRetning}`
              : `ORDER BY [${sorterKol}] ${cfg.sorterRetning}`)
          : '';

        sql = (baseUtenOrder + (orderByStr ? ' ' + orderByStr : '')).replace(/\s+/g, ' ').trim();
        console.log('[hentData] bruker original AI-SQL som base, ORDER BY:', orderByStr || '(ingen)');
      } else {
        sql = byggSQL(cfg, vn, where, kolonnTyperRef.current, kpiUtrykkRef.current);
      }
      console.log('[rapport-interaktiv] hentData SQL:', sql);
      const res = await apiFetch('/api/pbi/query-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      if (res.ok) {
        const d = await res.json() as { rows: Record<string,unknown>[] };
        setAktivData(d.rows ?? []);
      } else {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}`, detail: '' })) as { error?: string; detail?: string };
        const melding = errBody.detail || errBody.error || `HTTP ${res.status}`;
        console.error('[rapport-interaktiv] hentData SQL-feil:', res.status, melding);
        setQueryFeil(melding);
      }
    } catch (e) {
      console.warn('[rapport-interaktiv] hentData feil:', e);
      setQueryFeil(e instanceof Error ? e.message : 'Ukjent feil');
    } finally {
      setLasterData(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forslag, aktiveFiltre]);

  // ── Last lagret designer-rapport fra API (fraLagret=true path) ──
  async function lastLagretRapport(rapportId: string, oid: string) {
    setEksisterendeRapportId(rapportId);
    try {
      const res = await apiFetch(`/api/rapport-designer/${rapportId}`, {
        credentials: 'include',
        headers: { 'X-Entra-Object-Id': oid },
      });
      if (!res.ok) {
        console.error('[Designer] fant ikke lagret rapport:', rapportId, res.status);
        return;
      }
      const data = await res.json() as { id: string; navn: string; beskrivelse: string | null; config: Record<string, unknown> };
      const cfg = data.config;

      const pNr     = (cfg.prosjektNr as string | null) ?? (cfg.laastFilter as { verdi?: string } | null)?.verdi ?? null;
      const pKol    = (cfg.prosjektKolonne as string | null) ?? (cfg.laastFilter as { kolonne?: string } | null)?.kolonne ?? null;
      const pKolType = (cfg.prosjektKolonneType as string) ?? 'number';
      const vn      = (cfg.viewNavn as string | null) ?? null;

      // Sett refs synkront
      prosjektNrRef.current          = pNr;
      prosjektKolonneRef.current     = pKol;
      prosjektKolonneTypeRef.current = pKolType;
      viewNavnRef.current            = vn;
      fraRapportIdRef.current        = null;

      const nyConfig: RedigertConfig = {
        visualType:     (cfg.visualType as string) ?? 'bar',
        xAkse:          (cfg.xAkse as string) ?? '',
        yAkse:          (cfg.yAkse as string) ?? '',
        aggregering:    (cfg.aggregering as string) ?? 'SUM',
        grupperPaa:     (cfg.grupperPaa as string | null) ?? null,
        ekstraKolonner:  (cfg.ekstraKolonner as string[]) ?? [],
        kombinertSerier: (cfg.kombinertSerier as KombinertSerie[]) ?? [],
        sorterPaa:       (cfg.sorterPaa as string | null) ?? null,
        sorterRetning:  (cfg.sorterRetning as string) ?? 'DESC',
        maksRader:      (cfg.maksRader as number) ?? 50,
      };

      // Hent ferske kolonnetyper fra API — ikke bruk lagret config (kan være utdatert/feil)
      let alleViewKolonner = (cfg.alleViewKolonner as { kolonne_navn: string; kolonne_type: string; sql_uttrykk?: string; format?: string; visningsnavn?: string }[]) ?? [];
      if (vn) {
        try {
          const kolRes = await apiFetch(
            `/api/rapport-designer/view-kolonner?viewNavn=${encodeURIComponent(vn)}`,
            { credentials: 'include' },
          );
          if (kolRes.ok) {
            const kolData = await kolRes.json() as { kolonner: { kolonne_navn: string; kolonne_type: string; sql_uttrykk?: string; format?: string; visningsnavn?: string }[]; kilde: string };
            alleViewKolonner = kolData.kolonner ?? alleViewKolonner;
            console.log('[Designer] ferske kolonnetyper lastet | kilde:', kolData.kilde,
              '| measures:', alleViewKolonner.filter(k => k.kolonne_type === 'measure').map(k => k.kolonne_navn));
          } else {
            console.warn('[Designer] view-kolonner feilet, bruker lagret config');
          }
        } catch {
          console.warn('[Designer] view-kolonner fetch-feil, bruker lagret config');
        }
      }

      const typemap: Record<string, string> = {};
      for (const k of alleViewKolonner) typemap[k.kolonne_navn] = k.kolonne_type;

      setForslag({
        tittel: data.navn, beskrivelse: data.beskrivelse ?? '',
        sql: (cfg.sql as string) ?? '', viewNavn: vn, visualType: nyConfig.visualType,
        xAkse: nyConfig.xAkse, yAkse: nyConfig.yAkse,
        grupperPaa: nyConfig.grupperPaa ?? undefined, data: [],
        alleViewKolonner, prosjektNr: pNr, prosjektNavn: (cfg.prosjektNavn as string | null) ?? null,
        prosjektKolonne: pKol, prosjektKolonneType: pKolType,
        prosjektFilter: (cfg.prosjektFilter as string | null) ?? null,
        laastFilter: (cfg.laastFilter as { kolonne: string; verdi: string } | null) ?? null,
      });
      setConfig(nyConfig);
      setAktivData([]);
      const lagretFiltre = (cfg.aktiveFiltre as AktivFilter[] | undefined) ?? [];
      console.log('[lastLagret] config.aktiveFiltre:', lagretFiltre);
      setAktiveFiltre(lagretFiltre);
      setTilgjengeligeKolonner(alleViewKolonner.map(k => k.kolonne_navn));
      setKolonnTyper(typemap);
      const kpiMapLagret: Record<string, string> = {};
      const fmtMapLagret: Record<string, string> = {};
      const vnsMapLagret: Record<string, string> = {};
      for (const k of alleViewKolonner) {
        if (k.kolonne_type === 'kpi' && k.sql_uttrykk) {
          kpiMapLagret[k.kolonne_navn] = k.sql_uttrykk;
          if (k.format)       fmtMapLagret[k.kolonne_navn] = k.format;
          if (k.visningsnavn) vnsMapLagret[k.kolonne_navn] = k.visningsnavn;
        }
      }
      setKpiUttrykk(kpiMapLagret);
      setKpiFormat(fmtMapLagret);
      setKpiVisningsnavn(vnsMapLagret);

      // Gjenoppbygg valgteKolonner — verifiser mot ferske kolonner slik at utgåtte ikke tas med
      const gyldigeNavn = new Set(alleViewKolonner.map(k => k.kolonne_navn));
      const lagretValgteKolonner = (cfg.valgteKolonner as string[] | undefined) ?? [];
      const gjenopprettedeKolonner = lagretValgteKolonner.filter(k => gyldigeNavn.has(k));
      if (gjenopprettedeKolonner.length > 0) {
        console.log('[Designer] gjenoppretter valgteKolonner:', gjenopprettedeKolonner);
        setValgteKolonner(gjenopprettedeKolonner);
      } else if (nyConfig.visualType === 'table') {
        // Fallback: xAkse + yAkse
        const fallback = [nyConfig.xAkse, nyConfig.yAkse].filter(Boolean);
        console.log('[Designer] valgteKolonner fallback:', fallback);
        setValgteKolonner(fallback);
      }

      console.log('[Designer] lagret rapport lastet:', data.navn, '| viewNavn:', vn, '| prosjektNr:', pNr);

      setTimeout(() => {
        initialiseringFerdig.current = true;
        void hentData(nyConfig, lagretFiltre);
      }, 200);
    } catch (err) {
      console.error('[Designer] feil ved lasting av lagret rapport:', err);
    }
  }

  // ── fraLagret-path: trigger når entraObjectId er tilgjengelig ──
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('fraLagret') !== 'true') return;
    if (!entraObjectId) return;
    if (harInitialisert.current) return;
    harInitialisert.current = true;
    const rapportId = urlParams.get('rapportId');
    if (!rapportId) { console.error('[Designer] fraLagret=true men rapportId mangler!'); return; }
    void lastLagretRapport(rapportId, entraObjectId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entraObjectId]);

  // ── Re-fetch ved config-endringer (etter initialisering er ferdig) ──
  useEffect(() => {
    if (!initialiseringFerdig.current) return;
    const cfg = configRef.current;
    if (!cfg) return;
    if (!forslag?.viewNavn) return;
    // Tabell-modus krever valgteKolonner; chart-modus krever xAkse + yAkse
    const erTabell = cfg.visualType === 'table';
    if (erTabell && valgteKolonnerRef.current.length === 0) return;
    if (!erTabell && (!cfg.xAkse || !cfg.yAkse)) return;

    if (!autoRefresh) {
      setVentendePåRefresh(true);
      return;
    }

    console.log('[re-fetch effect] visualType:', cfg.visualType, '| xAkse:', cfg.xAkse, '| yAkse:', cfg.yAkse);
    hentData(cfg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.xAkse, config?.yAkse, config?.visualType, config?.aggregering, config?.sorterPaa, config?.sorterRetning, config?.maksRader, config?.ekstraKolonner, config?.kombinertSerier, aktiveFiltre, autoRefresh]);

  // ── Auto-oppdater sorteringsretning når xAkse endres ────────────────────────
  useEffect(() => {
    if (!config?.xAkse) return;
    const smartRetning = defaultSorterRetning(config.xAkse);
    setConfig(prev => prev ? { ...prev, sorterRetning: smartRetning } : prev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.xAkse]);

  // ── Initialiser valgteKolonner ved skifte til tabell-visning ──
  useEffect(() => {
    if (config?.visualType !== 'table') return;
    if (valgteKolonner.length > 0) return;
    // Bruk xAkse + yAkse fra forrige visual som startpunkt — aldri auto-velg alle kolonner
    const startKolonner = [config.xAkse, config.yAkse].filter(Boolean);
    console.log('[Tabell] initialiserer med:', startKolonner);
    setValgteKolonner(startKolonner);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.visualType]);

  // ── Re-fetch tabell når valgteKolonner endres ──
  useEffect(() => {
    if (!initialiseringFerdig.current) return;
    if (configRef.current?.visualType !== 'table') return;
    if (valgteKolonnerRef.current.length === 0) return;
    const cfg = configRef.current;
    if (!autoRefresh) { setVentendePåRefresh(true); return; }
    console.log('[Designer] valgteKolonner endret, oppdaterer tabell');
    hentData(cfg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valgteKolonner, autoRefresh]);

  // Tabell-kolonner styres nå av valgteKolonner state + valgteKolonner-useEffect

  // ── Filterhåndtering ──
  const leggTilFilter = () => {
    const ersteKolonne = tilgjengeligeKolonner.find(k => k !== (forslag?.prosjektKolonne ?? '')) ?? '';
    setAktiveFiltre(prev => [...prev, { kolonne: ersteKolonne, operator: '=', verdi: '' }]);
  };

  const fjernFilter = (idx: number) => {
    const oppdaterte = aktiveFiltre.filter((_, i) => i !== idx);
    setAktiveFiltre(oppdaterte);
    const cfg = configRef.current;
    if (cfg) hentData(cfg, oppdaterte);
  };

  const oppdaterFilterVerdi = (idx: number, verdi: string) => {
    const oppdaterte = aktiveFiltre.map((f, i) => i === idx ? { ...f, verdi } : f);
    setAktiveFiltre(oppdaterte);
    const cfg = configRef.current;
    if (verdi && cfg) hentData(cfg, oppdaterte);
  };

  const oppdaterFilterVerdi2 = (idx: number, verdi2: string) => {
    const oppdaterte = aktiveFiltre.map((f, i) => i === idx ? { ...f, verdi2 } : f);
    setAktiveFiltre(oppdaterte);
    const cfg = configRef.current;
    // Trigger kun når begge verdier er satt (BETWEEN krever begge)
    if (verdi2 && aktiveFiltre[idx]?.verdi && cfg) hentData(cfg, oppdaterte);
  };

  const oppdaterFilterOperator = (idx: number, operator: string) => {
    const oppdaterte = aktiveFiltre.map((f, i) => {
      if (i !== idx) return f;
      const { verdi2, ...rest } = f;
      // Behold verdi2 kun ved BETWEEN, fjern ellers
      return operator === 'BETWEEN' ? { ...f, operator } : { ...rest, operator };
    });
    setAktiveFiltre(oppdaterte);
    const cfg = configRef.current;
    if (aktiveFiltre[idx]?.verdi && cfg) hentData(cfg, oppdaterte);
  };

  const oppdaterFilterKolonne = (idx: number, kolonne: string) => {
    const oppdaterte = aktiveFiltre.map((f, i) => i === idx ? { ...f, kolonne, verdi: '' } : f);
    setAktiveFiltre(oppdaterte);
    // Ikke trigger hentData — verdi er nullstilt
  };

  const alleCols = useMemo(() => {
    const dataCols = aktivData.length ? Object.keys(aktivData[0]) : [];
    // Prioriter viewKolonner (alle kolonner fra view metadata), fall tilbake til dataCols
    const base = viewKolonner.length > 0 ? viewKolonner : dataCols;
    const merged = [...base];
    for (const k of [...tilgjengeligeKolonner, ...dataCols]) {
      if (!merged.includes(k)) merged.push(k);
    }
    return merged;
  }, [aktivData, tilgjengeligeKolonner, viewKolonner]);

  // Kolonner gruppert etter type (for optgroup-dropdowns)
  const kolGroups = useMemo(() => {
    const measures:    string[] = [];
    const dimensjoner: string[] = [];
    const datoer:      string[] = [];
    const ider:        string[] = [];
    const ukjente:     string[] = [];
    for (const col of alleCols) {
      const t = kolonnTyper[col];
      if (t === 'measure')   measures.push(col);
      else if (t === 'dato') datoer.push(col);
      else if (t === 'id')   ider.push(col);
      else if (t === 'dimensjon') dimensjoner.push(col);
      else ukjente.push(col);
    }
    return { measures, dimensjoner, datoer, ider, ukjente };
  }, [alleCols, kolonnTyper]);

  const harTyper = Object.keys(kolonnTyper).length > 0;

  const filtrerteData = useMemo(() => {
    if (!filterCol || !filterVal) return aktivData;
    const q = filterVal.toLowerCase();
    return aktivData.filter(r => String(r[filterCol] ?? '').toLowerCase().includes(q));
  }, [aktivData, filterCol, filterVal]);

  const behandletData = useMemo(() => {
    if (!config) return filtrerteData;
    let data = [...filtrerteData];
    if (config.sorterPaa) {
      data.sort((a, b) => {
        const av = a[config.sorterPaa!], bv = b[config.sorterPaa!];
        const mult = config.sorterRetning === 'DESC' ? -1 : 1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
        return String(av ?? '').localeCompare(String(bv ?? '')) * mult;
      });
    }
    return data.slice(0, config.maksRader);
  }, [filtrerteData, config]);

  const visKolonner = useMemo(() => {
    if (config?.visualType === 'table') {
      // Tabell: vis valgteKolonner (i bruker-valgt rekkefølge), filtrer til kolonner faktisk i dataene
      if (valgteKolonner.length > 0) return valgteKolonner.filter(c => aktivData.length === 0 || c in aktivData[0]);
      return alleCols.filter(c => aktivData.length === 0 || c in aktivData[0]);
    }
    if (!config || config.ekstraKolonner.length === 0) {
      return alleCols.filter(c => aktivData.length === 0 || c in aktivData[0]);
    }
    return config.ekstraKolonner;
  }, [config, valgteKolonner, alleCols, aktivData]);

  if (!forslag || !config) {
    return (
      <div className="flex items-center justify-center h-full">
        <div style={{ color:'var(--text-muted)', fontSize:14 }}>
          Ingen rapport lastet. Gå tilbake og be AI-assistenten lage en rapport.
        </div>
      </div>
    );
  }

  // Filter-badges for topbar — prosjektfilter er alltid låst, brukerfiltre vises separat
  const brukerFilterBadges = aktiveFiltre
    .filter(f => f.kolonne && (f.verdi || f.operator === 'IS NOT NULL' || f.operator === 'IS NULL') && f.kolonne !== (forslag.prosjektKolonne ?? ''))
    .map(f => f.operator === 'BETWEEN' && f.verdi2
      ? `${f.kolonne} mellom ${f.verdi} og ${f.verdi2}`
      : `${f.kolonne} ${f.operator} ${f.verdi}`);

  // Y-akse label: KPI-er viser visningsnavn, andre viser aggregering(kolonnenavn)
  const yAkseLabel = kpiUttrykk[config.yAkse]
    ? (kpiVisningsnavn[config.yAkse] || config.yAkse)
    : config.aggregering === 'NONE'
      ? config.yAkse
      : `${config.aggregering}(${config.yAkse})`;

  // Format-bevisst tallformatering for KPI-er
  const yFormat = kpiFormat[config.yAkse];
  function formaterVerdi(val: number, fmt?: string): string {
    if (fmt === 'prosent') return `${val.toFixed(2)} %`;
    if (fmt === 'nok') return val.toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' kr';
    return val.toLocaleString('nb-NO', { maximumFractionDigits: 0 });
  }

  const visTypeLabel: Record<string,string> = {
    bar:'Søylediagram', line:'Linjediagram', area:'Områdediagram',
    pie:'Kakediagram', card:'KPI-kort', table:'Tabell',
  };

  async function eksporterPDF() {
    if (eksporterer) return;
    const visRedigerTidligere = visRediger;
    setVisRediger(false);
    setEksporterer(true);
    await new Promise(r => setTimeout(r, 300));
    try {
      const chartEl  = document.querySelector('.rapport-chart-omraade') as HTMLElement | null;
      const tabellEl = document.querySelector('.rapport-tabell-omraade') as HTMLElement | null;
      const erTabell = tabellEl !== null && tabellEl.offsetParent !== null;
      const element  = erTabell ? tabellEl : chartEl;

      if (!element) {
        console.error('[PDF] fant ikke rapport-innhold');
        return;
      }

      console.log('[PDF] eksporterer:', erTabell ? 'tabell' : 'chart');

      // For tabell: fjern overflow-avskjæring midlertidig så alt rendres
      const origMaxHeight = element.style.maxHeight;
      const origOverflow  = element.style.overflow;
      if (erTabell) {
        element.style.maxHeight = 'none';
        element.style.overflow  = 'visible';
      }

      const canvas = await html2canvas(element, {
        backgroundColor: 'var(--navy-darkest)',
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth:  element.scrollWidth,
        windowHeight: element.scrollHeight,
        scrollX: 0,
        scrollY: 0,
      });

      if (erTabell) {
        element.style.maxHeight = origMaxHeight;
        element.style.overflow  = origOverflow;
      }

      const erLandskap  = canvas.width > canvas.height;
      const pdf = new jsPDF({ orientation: erLandskap ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth  = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const marginTop  = 25;
      const marginSide = 14;

      // Header
      pdf.setFillColor(10, 22, 40);
      pdf.rect(0, 0, pageWidth, marginTop - 3, 'F');
      pdf.setFontSize(14);
      pdf.setTextColor(245, 166, 35);
      pdf.text(forslag!.tittel, marginSide, 14);
      pdf.setFontSize(9);
      pdf.setTextColor(120, 130, 150);
      pdf.text(erTabell ? 'Tabell' : (config?.visualType ?? ''), marginSide, 20);
      pdf.text(new Date().toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' }), pageWidth - marginSide, 14, { align: 'right' });
      if (forslag!.prosjektNavn) {
        pdf.text(forslag!.prosjektNavn, pageWidth - marginSide, 20, { align: 'right' });
      }

      // Innhold — fordel på flere sider om nødvendig
      const imgBredd         = pageWidth - marginSide * 2;
      const imgHøyde         = (canvas.height * imgBredd) / canvas.width;
      const tilgjengeligHøyde = pageHeight - marginTop - 5;

      if (imgHøyde <= tilgjengeligHøyde) {
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', marginSide, marginTop, imgBredd, imgHøyde);
      } else {
        const scale = canvas.width / imgBredd;
        let yOffset = 0;
        let førsteSide = true;
        while (yOffset < imgHøyde) {
          if (!førsteSide) pdf.addPage();
          const startY    = førsteSide ? marginTop : 10;
          const sideHøyde = førsteSide ? tilgjengeligHøyde : pageHeight - 15;
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width  = canvas.width;
          tempCanvas.height = Math.min(sideHøyde * scale, canvas.height - yOffset * scale);
          const ctx = tempCanvas.getContext('2d')!;
          ctx.drawImage(canvas, 0, yOffset * scale, canvas.width, tempCanvas.height, 0, 0, canvas.width, tempCanvas.height);
          pdf.addImage(tempCanvas.toDataURL('image/png'), 'PNG', marginSide, startY, imgBredd, tempCanvas.height / scale);
          yOffset += sideHøyde;
          førsteSide = false;
        }
      }

      const filnavn = `${forslag!.tittel.replace(/[^a-zA-Z0-9æøåÆØÅ\s]/g, '').trim().replace(/\s+/g, '_')}.pdf`;
      pdf.save(filnavn);
    } catch (err) {
      console.error('[PDF] feil:', err);
      alert('PDF-eksport feilet: ' + (err as Error).message);
    } finally {
      setEksporterer(false);
      setVisRediger(visRedigerTidligere);
    }
  }

  function eksporterExcel() {
    if (!behandletData.length) return;
    const cols = visKolonner.length ? visKolonner : Object.keys(behandletData[0]);
    const eksportData = behandletData.map(rad => {
      const r: Record<string, unknown> = {};
      cols.forEach(k => { r[k] = rad[k]; });
      return r;
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(eksportData);
    ws['!cols'] = cols.map(k => ({ wch: Math.max(k.length, ...eksportData.map(r => String(r[k] ?? '').length), 6) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, `${forslag!.tittel}.xlsx`);
  }

  async function lagreRapport() {
    if (!forslag || !config || lagrer) return;
    setLagrer(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (entraObjectId) headers['X-Entra-Object-Id'] = entraObjectId;

      const erOppdatering = !!eksisterendeRapportId;
      console.log('[Lagre] modus:', erOppdatering ? 'oppdater' : 'ny', '| id:', eksisterendeRapportId);

      const configPayload = {
        sql: forslag.sql,
        viewNavn: forslag.viewNavn ?? viewNavnRef.current,
        visualType: config.visualType,
        xAkse: config.xAkse,
        yAkse: config.yAkse,
        grupperPaa: config.grupperPaa,
        aggregering: config.aggregering,
        prosjektNr: forslag.prosjektNr ?? prosjektNrRef.current,
        prosjektNavn: forslag.prosjektNavn,
        prosjektKolonne: forslag.prosjektKolonne ?? prosjektKolonneRef.current,
        prosjektKolonneType: forslag.prosjektKolonneType ?? prosjektKolonneTypeRef.current,
        prosjektFilter: forslag.prosjektFilter,
        laastFilter: (() => {
          const k = forslag.prosjektKolonne ?? prosjektKolonneRef.current;
          const v = forslag.prosjektNr      ?? prosjektNrRef.current;
          return (k && v) ? { kolonne: k, verdi: v } : null;
        })(),
        alleViewKolonner: forslag.alleViewKolonner ?? [],
        maksRader: config.maksRader,
        sorterPaa: config.sorterPaa,
        sorterRetning: config.sorterRetning,
        ekstraKolonner: config.ekstraKolonner,
        valgteKolonner,
        aktiveFiltre,
      };
      console.log('[Lagre] aktiveFiltre:', JSON.stringify(aktiveFiltre));
      console.log('[Lagre] valgteKolonner:', JSON.stringify(valgteKolonner));

      const url = erOppdatering
        ? `${API}/api/rapport-designer/${eksisterendeRapportId}`
        : `${API}/api/rapport-designer/lagre`;

      const res = await apiFetch(url.replace(API, ''), {
        method: erOppdatering ? 'PUT' : 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          tittel: forslag.tittel,
          beskrivelse: forslag.beskrivelse ?? '',
          ...(!erOppdatering && fraRapportIdRef.current ? { fraRapportId: fraRapportIdRef.current } : {}),
          config: configPayload,
        }),
      });
      const data = await res.json() as { success?: boolean; rapportId?: string; workspaceId?: string; error?: string };
      if (data.success) {
        setLagret(true);
        if (erOppdatering) {
          console.log('[Lagre] oppdatert:', eksisterendeRapportId);
          setTimeout(() => setLagret(false), 2000);
        } else {
          if (data.rapportId) setEksisterendeRapportId(data.rapportId);
          console.log('[Lagre] ny rapport:', data.rapportId, '→ workspace:', data.workspaceId);
          setTimeout(() => {
            setLagret(false);
            if (data.workspaceId) router.push(`/dashboard/workspace/${data.workspaceId}`);
          }, 1500);
        }
      } else {
        alert('Lagring feilet: ' + (data.error ?? 'Ukjent feil'));
      }
    } catch (err) {
      console.error('[Lagre] feil:', err);
      alert('Lagring feilet: ' + (err as Error).message);
    } finally {
      setLagrer(false);
    }
  }

  function renderChart() {
    if (!config) return null;
    if (!behandletData.length) return (
      <div style={{ color:'var(--text-muted)', padding:40, textAlign:'center' }}>Ingen data å vise.</div>
    );
    switch (config.visualType) {
      case 'bar':   return <BarChart  data={behandletData} xCol={config.xAkse} yCol={config.yAkse} grupperPaa={config.grupperPaa} yLabel={yAkseLabel} yFormat={yFormat} formaterVerdi={formaterVerdi}/>;
      case 'line':  return <LineChart data={behandletData} xCol={config.xAkse} yCol={config.yAkse} yLabel={yAkseLabel} yFormat={yFormat} formaterVerdi={formaterVerdi}/>;
      case 'area':  return <LineChart data={behandletData} xCol={config.xAkse} yCol={config.yAkse} area yLabel={yAkseLabel} yFormat={yFormat} formaterVerdi={formaterVerdi}/>;
      case 'pie':       return <PieChart       data={behandletData} xCol={config.xAkse} yCol={config.yAkse}/>;
      case 'card':      return <CardChart      data={behandletData} yCol={config.yAkse} yLabel={yAkseLabel}/>;
      case 'table':     return null;
      case 'kombinert': return <KombinertChart data={behandletData} xCol={config.xAkse} stolpeKol={config.yAkse} linjeKol={config.ekstraKolonner?.[0] ?? ''} serier={config.kombinertSerier.length > 0 ? config.kombinertSerier : undefined}/>;
      default:          return <BarChart       data={behandletData} xCol={config.xAkse} yCol={config.yAkse} yLabel={yAkseLabel}/>;
    }
  }

  return (
    <div className="rapport-fullskjerm" style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      {/* ── Topbar ── */}
      <div className="rapport-topbar" style={{ flexShrink:0, display:'flex', alignItems:'center', gap:12, padding:'10px 20px', background:'var(--gold-dim)', borderBottom:'1px solid var(--gold-dim)' }}>
        <button type="button" onClick={()=>router.back()}
          style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer' }}
          onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.color='var(--text-secondary)';}}
          onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.color='var(--text-muted)';}}>
          <ArrowLeft style={{ width:14, height:14 }}/> Tilbake
        </button>

        <div style={{ fontFamily:'Barlow Condensed, sans-serif', fontWeight:700, fontSize:15, color:'var(--gold)', letterSpacing:'0.04em' }}>
          {forslag.tittel}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', flex:1, minWidth:0 }}>
          <span style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>
            {config.visualType==='table' ? '📋 Tabell' : `📊 ${visTypeLabel[config.visualType]??config.visualType}`} · {yAkseLabel} · {behandletData.length} rader
          </span>
          {/* Låst prosjektfilter-badge */}
          {(() => {
            const pKol = forslag.prosjektKolonne ?? prosjektKolonneRef.current;
            const pNr  = forslag.prosjektNr      ?? prosjektNrRef.current;
            const pFilter = forslag.prosjektFilter;
            if (!pFilter && !(pKol && pNr)) return null;
            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 10px 3px 8px', borderRadius: 12,
                background: 'var(--glass-gold-bg)',
                border: '1px solid var(--gold-dim)',
                color: 'var(--gold)', fontSize: 11, fontWeight: 600,
                letterSpacing: '0.02em', userSelect: 'none', whiteSpace: 'nowrap',
              }}>
                <svg width="10" height="11" viewBox="0 0 10 11" fill="none" style={{ flexShrink: 0 }}>
                  <rect x="1.5" y="5" width="7" height="5.5" rx="1" stroke="var(--gold)" strokeWidth="1.2"/>
                  <path d="M3 5V3.5a2 2 0 014 0V5" stroke="var(--gold)" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                {pKol && pNr
                  ? `${pKol} = ${pNr}`
                  : pFilter?.replace(/^WHERE\s+/i, '').trim()
                }
              </div>
            );
          })()}
          {/* Bruker-definerte filter-badges */}
          {brukerFilterBadges.map((badge, i) => (
            <span key={i} style={{
              fontSize: 11, fontWeight: 600,
              padding: '2px 8px', borderRadius: 12,
              background: 'var(--glass-gold-bg)',
              border: '1px solid var(--glass-gold-border)',
              color: 'var(--gold)', letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
            }}>
              {badge}
            </span>
          ))}
          {lasterData && <span style={{ fontSize:11, color:'var(--gold)', whiteSpace:'nowrap' }}>↻ oppdaterer...</span>}
        </div>

        <button type="button" onClick={lagreRapport} disabled={lagrer}
          style={{ display:'flex', alignItems:'center', gap:6,
            background: lagret ? 'rgba(34,197,94,0.12)' : 'var(--glass-gold-bg)',
            border: lagret ? '1px solid rgba(34,197,94,0.30)' : '1px solid var(--gold-dim)',
            color: lagret ? '#4ade80' : 'var(--gold)',
            padding:'7px 16px', borderRadius:8, fontSize:13, fontWeight:600,
            cursor: lagrer ? 'not-allowed' : 'pointer', opacity: lagrer ? 0.6 : 1,
          }}>
          <Save style={{ width:14, height:14 }}/>
          {lagrer ? 'Lagrer...' : lagret ? '✓ Lagret!' : eksisterendeRapportId ? 'Oppdater rapport' : 'Lagre rapport'}
        </button>

        <button type="button" onClick={()=>setVisRediger(v=>!v)}
          style={{ background:visRediger?'var(--gold-dim)':'var(--glass-bg)', border:visRediger?'1px solid var(--gold-dim)':'1px solid var(--glass-border)', color:visRediger?'var(--gold)':'var(--text-secondary)', padding:'7px 14px', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
          ✏️ {visRediger ? 'Skjul rediger' : 'Rediger'}
        </button>

        {config.visualType!=='table' && (
          <button type="button" onClick={()=>setVisTabell(v=>!v)}
            style={{ background:visTabell?'var(--glass-gold-border)':'var(--glass-bg)', border:`1px solid ${visTabell?'var(--gold-dim)':'var(--glass-border)'}`, color:visTabell?'var(--gold)':'var(--text-secondary)', padding:'7px 14px', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
            {visTabell ? 'Skjul tabell' : 'Vis tabell'}
          </button>
        )}

        <button type="button" onClick={()=>exportToCsv(behandletData, forslag.tittel)}
          style={{ display:'flex', alignItems:'center', gap:6, background:'var(--glass-bg)', border:'1px solid var(--glass-border)', color:'var(--text-secondary)', padding:'7px 14px', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}
          onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.color='var(--text-primary)';}}
          onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.color='var(--text-secondary)';}}>
          <Download style={{ width:14, height:14 }}/> CSV
        </button>

        <button type="button" onClick={eksporterExcel}
          style={{ display:'flex', alignItems:'center', gap:6, background:'var(--glass-bg)', border:'1px solid var(--glass-border)', color:'var(--text-secondary)', padding:'7px 14px', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}
          onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.color='var(--text-primary)';}}
          onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.color='var(--text-secondary)';}}>
          <FileSpreadsheet style={{ width:14, height:14 }}/> Excel
        </button>

        <button type="button" onClick={eksporterPDF} disabled={eksporterer}
          style={{ display:'flex', alignItems:'center', gap:6, background:'var(--glass-bg)', border:'1px solid var(--glass-border)', color: eksporterer ? 'var(--text-muted)' : 'var(--text-secondary)', padding:'7px 14px', borderRadius:8, fontSize:13, fontWeight:600, cursor: eksporterer ? 'not-allowed' : 'pointer' }}>
          {eksporterer ? '⏳ Genererer...' : '📄 PDF'}
        </button>
      </div>

      {/* ── Filter-rad (topbar linje 2) ── */}
      <div style={{ flexShrink:0, display:'flex', alignItems:'center', gap:8, padding:'8px 20px', borderBottom:'1px solid var(--glass-bg)', flexWrap:'wrap', minHeight:44, background:'var(--gold-dim)' }}>
        <span style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', flexShrink:0 }}>
          Filter
        </span>
        {aktiveFiltre.map((filter, idx) => (
          filter.kolonne ? (
            filter.erLåst ? (
              // Låst filter — kun for workspace-kontekst (prosjektfilter), ikke redigerbart
              <div key={idx} style={{ display:'flex', alignItems:'center', gap:5, background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.25)', borderRadius:6, padding:'3px 9px', fontSize:12, color:'rgba(251,191,36,0.85)', flexShrink:0 }}>
                <span style={{ fontSize:10, opacity:0.7 }}>🔒</span>
                <span style={{ fontWeight:500 }}>{filter.kolonne}</span>
                <span style={{ color:'rgba(251,191,36,0.55)', fontSize:11 }}>
                  {filter.operator === 'BETWEEN'
                    ? `mellom ${filter.verdi} og ${filter.verdi2 ?? '?'}`
                    : `${filter.operator} ${filter.verdi}`}
                </span>
              </div>
            ) : (
              // Redigerbart filter
              <div key={idx} style={{ display:'flex', alignItems:'center', gap:4, background:'var(--glass-bg)', border:'1px solid var(--glass-border)', borderRadius:6, padding:'3px 6px 3px 8px', fontSize:12 }}>
                <select value={filter.kolonne}
                  onChange={e => oppdaterFilterKolonne(idx, e.target.value)}
                  style={{ background:'transparent', border:'none', color:'var(--text-primary)', fontSize:12, cursor:'pointer', outline:'none', maxWidth:130 }}>
                  {tilgjengeligeKolonner
                    .filter(k => k !== (forslag.prosjektKolonne ?? ''))
                    .map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <select value={filter.operator}
                  onChange={e => oppdaterFilterOperator(idx, e.target.value)}
                  style={{ background:'transparent', border:'none', color:'var(--text-secondary)', fontSize:11, cursor:'pointer', outline:'none' }}>
                  {OPERATORER.map(op => <option key={op.verdi} value={op.verdi}>{op.label}</option>)}
                </select>
                {filter.operator === 'BETWEEN' ? (
                  <>
                    <input type="text" value={filter.verdi} onChange={e => oppdaterFilterVerdi(idx, e.target.value)}
                      placeholder="Fra..." style={{ background:'var(--glass-bg)', border:'1px solid var(--glass-border)', color:'var(--text-primary)', borderRadius:4, fontSize:11, padding:'3px 6px', outline:'none', width:72 }} />
                    <span style={{ color:'var(--text-muted)', fontSize:11, flexShrink:0 }}>og</span>
                    <input type="text" value={filter.verdi2 ?? ''} onChange={e => oppdaterFilterVerdi2(idx, e.target.value)}
                      placeholder="Til..." style={{ background:'var(--glass-bg)', border:'1px solid var(--glass-border)', color:'var(--text-primary)', borderRadius:4, fontSize:11, padding:'3px 6px', outline:'none', width:72 }} />
                  </>
                ) : (
                  <FilterVerdiInput
                    kolonne={filter.kolonne}
                    operator={filter.operator}
                    verdi={filter.verdi}
                    onChange={verdi => oppdaterFilterVerdi(idx, verdi)}
                    viewNavn={forslag.viewNavn}
                    prosjektFilter={forslag.prosjektFilter}
                    kolonneTyper={kolonnTyper}
                    alleViewKolonner={forslag?.alleViewKolonner ?? []}
                    onEnter={() => { const cfg = configRef.current; if (cfg) hentData(cfg, aktiveFiltre); }}
                    aktiveFiltre={aktiveFiltre.filter((_, filterIdx) => filterIdx !== idx)}
                  />
                )}
                <button type="button" onClick={() => fjernFilter(idx)}
                  style={{ background:'none', border:'none', color:'rgba(255,100,100,0.6)', cursor:'pointer', fontSize:13, padding:'0 2px', lineHeight:1, flexShrink:0 }}>
                  ✕
                </button>
              </div>
            )
          ) : null
        ))}
        <button type="button" onClick={leggTilFilter}
          style={{ background:'var(--glass-bg)', border:'1px dashed var(--glass-border-hover)', color:'var(--text-muted)', borderRadius:6, padding:'4px 12px', fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}>
          + Filter
        </button>

        <div style={{ flex: 1 }} />

        {/* Stor view-advarsel */}
        {storViewAdvarsel && (
          <div style={{
            fontSize: 12, color: 'rgba(251,191,36,0.9)',
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 6, padding: '4px 10px',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            ⚠️ Stort datasett — legg til filtre og trykk Oppdater
          </div>
        )}

        {/* Auto-refresh toggle */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '3px 8px', borderRadius: 6,
          background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
        }}>
          <button
            type="button"
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? 'Slå av auto-refresh' : 'Slå på auto-refresh'}
            style={{
              width: 32, height: 18, borderRadius: 9,
              border: 'none', cursor: 'pointer',
              position: 'relative', transition: 'background 0.2s',
              background: autoRefresh ? 'var(--gold)' : 'var(--glass-border)',
              flexShrink: 0,
            }}
          >
            <span style={{
              position: 'absolute', top: 2,
              left: autoRefresh ? 16 : 2,
              width: 14, height: 14, borderRadius: '50%',
              background: 'white', transition: 'left 0.2s',
            }} />
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            Auto
          </span>
        </div>

        {/* Oppdater data-knapp */}
        <button
          type="button"
          onClick={() => { const cfg = configRef.current; if (cfg) hentData(cfg); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 6,
            border: ventendePåRefresh ? '1px solid var(--glass-gold-border)' : '1px solid var(--glass-border)',
            background: ventendePåRefresh ? 'var(--glass-gold-bg)' : 'var(--glass-bg)',
            color: ventendePåRefresh ? 'var(--gold)' : 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.2s', whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-gold-border)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--gold)';
          }}
          onMouseLeave={e => {
            if (!ventendePåRefresh) {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-border)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
            }
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          {ventendePåRefresh ? 'Oppdater data ●' : 'Oppdater data'}
        </button>
      </div>

      {/* ── Content ── */}
      <div style={{ flex:1, minHeight:0, overflow:'hidden', display:'flex', flexDirection:'column', background:'rgba(8,14,28,0.95)' }}>

        {/* Chart + Rediger panel */}
        <div style={{ flex:1, minHeight:0, display:'flex', gap:16, padding:20, overflow:'hidden' }}>

          {/* Chart area */}
          <div className="rapport-chart-omraade" style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:16, overflowY:'auto' }}>
            {config.visualType!=='table' && (
              <div style={{ borderRadius:12, padding:16, background:'var(--glass-bg)', border:'1px solid var(--glass-bg-hover)' }}>
                {lasterData
                  ? <div style={{ color:'var(--text-muted)', padding:40, textAlign:'center' }}>Henter data...</div>
                  : queryFeil
                    ? (
                      <div style={{ padding:'32px 24px', textAlign:'center' }}>
                        <div style={{ fontSize:22, marginBottom:10 }}>⚠️</div>
                        <div style={{ fontSize:13, fontWeight:700, color:'rgba(255,100,100,0.9)', marginBottom:8 }}>
                          SQL-feil ved datahenting
                        </div>
                        <div style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'monospace', background:'rgba(0,0,0,0.3)', borderRadius:6, padding:'8px 12px', maxWidth:520, margin:'0 auto', wordBreak:'break-all' }}>
                          {queryFeil}
                        </div>
                        <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:12 }}>
                          Prøv å legge til filtre for å begrense datasettet, eller velg en annen datakilde.
                        </div>
                      </div>
                    )
                  : renderChart()
                }
              </div>
            )}
            {(visTabell||config.visualType==='table') && (
              <div className="rapport-tabell-omraade" style={{ borderRadius:12, padding:16, background:'var(--glass-bg)', border:'1px solid var(--glass-bg-hover)' }}>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:10, fontFamily:'Barlow Condensed', letterSpacing:'0.08em', fontWeight:700 }}>DATATABELL</div>
                <DataTable data={behandletData} visKolonner={visKolonner} alleViewKolonner={forslag.alleViewKolonner}/>
              </div>
            )}
          </div>

          {/* ── Rediger-panel ── */}
          {visRediger && (
            <div className="rapport-rediger-panel" style={{ width:280, flexShrink:0, background:'var(--glass-bg)', border:'1px solid var(--glass-bg-hover)', borderRadius:12, padding:16, overflowY:'auto', display:'flex', flexDirection:'column', gap:16 }}>
              <div style={{ fontFamily:'Barlow Condensed, sans-serif', fontWeight:700, fontSize:14, color:'var(--gold)', letterSpacing:'0.06em', textTransform:'uppercase' }}>
                ⚙ Rediger rapport
              </div>

              {/* Visual-type */}
              <div>
                <label style={labelStyle}>Visual-type</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                  {VIS_TYPE_OPTIONS.map(v => (
                    <button key={v.type} type="button" onClick={()=>{
                      setConfig(p => {
                        if (!p) return p;
                        const forrige = p.visualType;
                        const ny = v.type;
                        if (forrige === ny) return p;
                        if (forrige === 'table' && ny !== 'table') setValgteKolonner([]);
                        return { ...p, visualType: ny, sorterPaa: null, sorterRetning: 'DESC' };
                      });
                    }}
                      style={{ padding:8, borderRadius:7, cursor:'pointer', border:config.visualType===v.type?'1px solid var(--gold-dim)':'1px solid var(--glass-bg-hover)', background:config.visualType===v.type?'var(--glass-gold-bg)':'var(--glass-bg)', color:config.visualType===v.type?'var(--gold)':'var(--text-secondary)', fontSize:12, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                      <span style={{ fontSize:18 }}>{v.ikon}</span><span>{v.navn}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* X-akse */}
              {config.visualType!=='card' && (
                <div>
                  <label style={labelStyle}>{config.visualType==='table'?'Primærkolonne':'Kategori (X-akse)'}</label>
                  <select value={config.xAkse} onChange={e=>{
                    const nyCfg = {...config, xAkse: e.target.value};
                    setConfig(nyCfg);
                    hentData(nyCfg);
                  }} style={selectStyle}>
                    {harTyper ? (
                      <>
                        {kolGroups.dimensjoner.length>0 && <optgroup label="Dimensjoner">{kolGroups.dimensjoner.map(c=><option key={c} value={c}>{c}</option>)}</optgroup>}
                        {kolGroups.datoer.length>0      && <optgroup label="Dato">{kolGroups.datoer.map(c=><option key={c} value={c}>{c}</option>)}</optgroup>}
                        {kolGroups.ider.length>0         && <optgroup label="ID">{kolGroups.ider.map(c=><option key={c} value={c}>{c}</option>)}</optgroup>}
                        {kolGroups.measures.length>0    && <optgroup label="Mål">{kolGroups.measures.map(c=><option key={c} value={c}>{c}</option>)}</optgroup>}
                        {kolGroups.ukjente.length>0     && <optgroup label="Andre">{kolGroups.ukjente.map(c=><option key={c} value={c}>{c}</option>)}</optgroup>}
                      </>
                    ) : (
                      alleCols.map(c=><option key={c} value={c}>{c}</option>)
                    )}
                  </select>
                </div>
              )}

              {/* Y-akse */}
              {config.visualType!=='table' && (
                <div>
                  <label style={labelStyle}>Verdi (Y-akse)</label>
                  <select value={config.yAkse} onChange={e=>{
                    const col = e.target.value;
                    const type = kolonnTyper[col];
                    setConfig(p => {
                      if (!p) return p;
                      // Auto-switch til COUNT om valgt kolonne er dimensjon/dato/id
                      const foreslåttAgg = (type === 'measure' || !type) ? p.aggregering : (p.aggregering === 'SUM' || p.aggregering === 'AVG' || p.aggregering === 'MEDIAN' ? 'COUNT' : p.aggregering);
                      return { ...p, yAkse: col, aggregering: foreslåttAgg };
                    });
                  }} style={selectStyle}>
                    {harTyper ? (
                      <>
                        {kolGroups.measures.length>0    && <optgroup label="Mål">{kolGroups.measures.map(c=><option key={c} value={c}>{c}</option>)}</optgroup>}
                        {kolGroups.dimensjoner.length>0 && <optgroup label="Dimensjoner">{kolGroups.dimensjoner.map(c=><option key={c} value={c}>{c}</option>)}</optgroup>}
                        {kolGroups.datoer.length>0      && <optgroup label="Dato">{kolGroups.datoer.map(c=><option key={c} value={c}>{c}</option>)}</optgroup>}
                        {kolGroups.ider.length>0         && <optgroup label="ID">{kolGroups.ider.map(c=><option key={c} value={c}>{c}</option>)}</optgroup>}
                        {kolGroups.ukjente.length>0     && <optgroup label="Andre">{kolGroups.ukjente.map(c=><option key={c} value={c}>{c}</option>)}</optgroup>}
                      </>
                    ) : (
                      alleCols.map(c=><option key={c} value={c}>{c}</option>)
                    )}
                  </select>
                </div>
              )}

              {/* Serier (kun for kombinert) */}
              {config.visualType === 'kombinert' && (
                <div style={{ marginTop: 12 }}>
                  <p style={labelStyle}>SERIER</p>

                  {config.kombinertSerier.map((serie, idx) => (
                    <div key={serie.id} style={{
                      background: 'var(--glass-bg)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      marginBottom: 8,
                    }}>
                      {/* Navn + stolpe/linje-toggle */}
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input
                          type="text"
                          value={serie.navn}
                          placeholder="Serienavn, f.eks. RUH"
                          onChange={e => {
                            const oppdatert = [...config.kombinertSerier];
                            oppdatert[idx] = { ...serie, navn: e.target.value };
                            setConfig(p => p ? { ...p, kombinertSerier: oppdatert } : p);
                          }}
                          style={{ ...fvInputStyle, flex: 1, fontSize: 12, padding: '5px 8px' }}
                        />
                        <div style={{ display: 'flex', gap: 4 }}>
                          {(['stolpe', 'linje'] as const).map(type => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => {
                                const oppdatert = [...config.kombinertSerier];
                                oppdatert[idx] = { ...serie, visningsType: type };
                                setConfig(p => p ? { ...p, kombinertSerier: oppdatert } : p);
                              }}
                              style={{
                                padding: '3px 8px', fontSize: 11, borderRadius: 5,
                                border: '1px solid var(--glass-border)',
                                background: serie.visningsType === type ? 'var(--glass-gold-bg)' : 'var(--glass-bg)',
                                color: serie.visningsType === type ? 'var(--gold)' : 'var(--text-muted)',
                                cursor: 'pointer',
                              }}
                            >
                              {type === 'stolpe' ? '▊' : '╱'} {type}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Kolonne som aggregeres */}
                      <select
                        value={serie.kolonne}
                        onChange={e => {
                          const oppdatert = [...config.kombinertSerier];
                          oppdatert[idx] = { ...serie, kolonne: e.target.value };
                          setConfig(p => p ? { ...p, kombinertSerier: oppdatert } : p);
                        }}
                        style={{ ...selectStyle, marginBottom: 6, fontSize: 12 }}
                      >
                        <option value="">— Velg kolonne —</option>
                        {kolGroups.measures.map(k => <option key={k} value={k}>{k}</option>)}
                      </select>

                      {/* Filter: kolonne + operator + verdi */}
                      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                        <select
                          value={serie.filterKol}
                          onChange={e => {
                            const oppdatert = [...config.kombinertSerier];
                            oppdatert[idx] = { ...serie, filterKol: e.target.value };
                            setConfig(p => p ? { ...p, kombinertSerier: oppdatert } : p);
                          }}
                          style={{ ...selectStyle, flex: 2, fontSize: 11 }}
                        >
                          <option value="">— Filter-kolonne —</option>
                          {kolGroups.dimensjoner.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                        <select
                          value={serie.filterOp}
                          onChange={e => {
                            const oppdatert = [...config.kombinertSerier];
                            oppdatert[idx] = { ...serie, filterOp: e.target.value };
                            setConfig(p => p ? { ...p, kombinertSerier: oppdatert } : p);
                          }}
                          style={{ ...selectStyle, flex: 1, fontSize: 11 }}
                        >
                          {['=', '!=', '>', '<', 'LIKE'].map(op => (
                            <option key={op} value={op}>{op}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          type="text"
                          value={serie.filterVerdi}
                          placeholder="Verdi, f.eks. RUH"
                          onChange={e => {
                            const oppdatert = [...config.kombinertSerier];
                            oppdatert[idx] = { ...serie, filterVerdi: e.target.value };
                            setConfig(p => p ? { ...p, kombinertSerier: oppdatert } : p);
                          }}
                          style={{ ...fvInputStyle, flex: 1, fontSize: 12, padding: '5px 8px' }}
                        />
                        <button
                          type="button"
                          onClick={() => setConfig(p => p ? {
                            ...p,
                            kombinertSerier: config.kombinertSerier.filter((_, i) => i !== idx),
                          } : p)}
                          style={{
                            padding: '4px 8px', fontSize: 12, borderRadius: 5,
                            border: '1px solid rgba(239,68,68,0.3)',
                            background: 'rgba(239,68,68,0.1)',
                            color: 'rgba(252,165,165,0.9)',
                            cursor: 'pointer',
                          }}
                        >
                          ✕
                        </button>
                      </div>

                      {/* Kumulativ toggle */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        marginTop: 6, paddingTop: 6,
                        borderTop: '1px solid var(--glass-border)',
                      }}>
                        <button
                          type="button"
                          onClick={() => {
                            const oppdatert = [...config.kombinertSerier];
                            oppdatert[idx] = { ...serie, kumulativ: !serie.kumulativ };
                            setConfig(p => p ? { ...p, kombinertSerier: oppdatert } : p);
                          }}
                          style={{
                            width: 32, height: 18, borderRadius: 9,
                            border: 'none', cursor: 'pointer',
                            background: serie.kumulativ ? 'var(--gold)' : 'var(--glass-bg-hover)',
                            position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                          }}
                        >
                          <span style={{
                            position: 'absolute', top: 2,
                            left: serie.kumulativ ? 16 : 2,
                            width: 14, height: 14, borderRadius: '50%',
                            background: 'white', transition: 'left 0.2s',
                          }} />
                        </button>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Kumulativ (løpende sum)
                        </span>
                        {serie.kumulativ && (
                          <span style={{
                            fontSize: 10, padding: '1px 6px', borderRadius: 4,
                            background: 'var(--glass-gold-bg)',
                            border: '1px solid var(--glass-gold-border)',
                            color: 'var(--gold)',
                          }}>
                            ∑ akkumulert
                          </span>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Legg til ny serie */}
                  <button
                    type="button"
                    onClick={() => {
                      const nySerie: KombinertSerie = {
                        id: crypto.randomUUID(),
                        navn: '',
                        kolonne: kolGroups.measures[0] ?? '',
                        aggregering: config.aggregering,
                        filterKol: kolGroups.dimensjoner[0] ?? '',
                        filterOp: '=',
                        filterVerdi: '',
                        visningsType: config.kombinertSerier.length === 0 ? 'stolpe' : 'linje',
                        kumulativ:    false,
                      };
                      setConfig(p => p ? { ...p, kombinertSerier: [...config.kombinertSerier, nySerie] } : p);
                    }}
                    style={{
                      width: '100%', padding: '6px', fontSize: 12, borderRadius: 6,
                      border: '1px dashed var(--glass-gold-border)',
                      background: 'var(--glass-gold-bg)',
                      color: 'var(--gold)', cursor: 'pointer', marginTop: 4,
                    }}
                  >
                    + Legg til serie
                  </button>

                  {/* Enkel linje-serie (fallback) */}
                  <div style={{ marginTop: 12 }}>
                    <p style={{ ...labelStyle, color: 'var(--text-muted)', fontSize: 10 }}>
                      ELLER — ENKEL LINJE-SERIE (Y2-AKSE)
                    </p>
                    <select
                      value={config.ekstraKolonner?.[0] ?? ''}
                      onChange={e => setConfig(p => p ? { ...p, ekstraKolonner: e.target.value ? [e.target.value] : [] } : p)}
                      style={{ ...selectStyle, fontSize: 12 }}
                    >
                      <option value="">— Ingen enkel linje —</option>
                      {kolGroups.measures
                        .filter(k => k !== config.xAkse && k !== config.yAkse)
                        .map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* ── Aggregering ── */}
              {config.visualType!=='table' && (
                <div>
                  <label style={labelStyle}>Aggregering</label>
                  {kpiUttrykk[config.yAkse] ? (
                    <div style={{ padding:'8px 10px', borderRadius:7, background:'rgba(251,146,60,0.08)', border:'1px solid rgba(251,146,60,0.25)', fontSize:11, color:'rgba(251,146,60,0.9)', lineHeight:1.5 }}>
                      <span style={{ fontWeight:700 }}>K</span> KPI{kpiFormat[config.yAkse] ? ` (${kpiFormat[config.yAkse]})` : ''} — aggregering håndteres automatisk av SQL-uttrykket
                    </div>
                  ) : (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
                      {AGG_OPTIONS.map(a => (
                        <button key={a.verdi} type="button"
                          onClick={()=>setConfig(p=>p?{...p,aggregering:a.verdi}:p)}
                          style={{
                            padding:'7px 6px', borderRadius:7, cursor:'pointer',
                            border: config.aggregering===a.verdi ? '1px solid var(--gold-dim)' : '1px solid var(--glass-bg-hover)',
                            background: config.aggregering===a.verdi ? 'var(--glass-gold-bg)' : 'var(--glass-bg)',
                            color: config.aggregering===a.verdi ? 'var(--gold)' : 'var(--text-secondary)',
                            fontSize:11, display:'flex', flexDirection:'column', alignItems:'center', gap:2,
                            fontFamily:'Barlow, sans-serif',
                          }}>
                          <span style={{ fontSize:15, fontWeight:700, fontFamily:'monospace' }}>{a.ikon}</span>
                          <span>{a.navn}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Aktuelt uttrykk */}
                  <div style={{ marginTop:8, fontSize:11, color:'var(--text-muted)', fontFamily:'monospace', background:'var(--glass-bg)', borderRadius:5, padding:'4px 8px' }}>
                    {yAkseLabel}
                  </div>
                </div>
              )}

              {/* Grupper på */}
              {['bar','line','area','kombinert'].includes(config.visualType) && (
                <div>
                  <label style={labelStyle}>Grupper på (valgfritt)</label>
                  <select value={config.grupperPaa??''} onChange={e=>setConfig(p=>p?{...p,grupperPaa:e.target.value||null}:p)} style={selectStyle}>
                    <option value="">Ingen gruppering</option>
                    {alleCols.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}

              {/* Tabell-kolonner — alle kolonner fra viewet */}
              {config.visualType==='table' && (
                <div>
                  <label style={labelStyle}>Vis kolonner ({tilgjengeligeKolonner.length})</label>
                  <div style={{ display:'flex', flexDirection:'column', gap:3, maxHeight:220, overflowY:'auto' }}>
                    {tilgjengeligeKolonner.map(kol => {
                      const type      = kolonnTyper[kol] ?? 'dimensjon';
                      const checked   = valgteKolonner.includes(kol);
                      const typeIkon  = type==='measure' ? 'Σ' : type==='kpi' ? 'K' : type==='dato' ? '⌚' : type==='id' ? '#' : '≡';
                      const typeColor = type==='measure' ? 'var(--gold)' : type==='kpi' ? 'rgba(251,146,60,0.9)' : type==='dato' ? 'rgba(110,231,183,0.9)' : type==='id' ? 'rgba(200,200,200,0.5)' : 'rgba(147,197,253,0.9)';
                      return (
                        <label key={kol} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--text-secondary)', cursor:'pointer', padding:'2px 0' }}>
                          <input type="checkbox" checked={checked} style={{ accentColor:'var(--gold)', flexShrink:0 }}
                            onChange={e => {
                              setValgteKolonner(prev =>
                                e.target.checked ? [...prev, kol] : prev.filter(k => k !== kol)
                              );
                            }}/>
                          <span style={{ fontSize:11, fontWeight:700, fontFamily:'monospace', color:typeColor, width:14, textAlign:'center', flexShrink:0 }}>{typeIkon}</span>
                          <span>{kol}</span>
                        </label>
                      );
                    })}
                  </div>
                  {valgteKolonner.length>0 && (
                    <button type="button" onClick={()=>setValgteKolonner([])}
                      style={{ marginTop:6, fontSize:11, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer' }}>
                      Nullstill kolonnevalg
                    </button>
                  )}
                </div>
              )}

              {/* Sortering */}
              <div>
                <label style={labelStyle}>Sorter etter</label>
                <select value={config.sorterPaa??''} onChange={e=>setConfig(p=>p?{...p,sorterPaa:e.target.value||null}:p)} style={{...selectStyle, marginBottom:6}}>
                  <option value="">Ingen sortering</option>
                  {alleCols.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                <select value={config.sorterRetning} onChange={e=>setConfig(p=>p?{...p,sorterRetning:e.target.value}:p)} style={selectStyle}>
                  <option value="DESC">Høyest først</option>
                  <option value="ASC">Lavest først</option>
                </select>
              </div>

              {/* Maks rader */}
              <div>
                <label style={labelStyle}>Maks rader: {config.maksRader}</label>
                <input type="range" min="5" max="200" step="5" value={config.maksRader}
                  onChange={e=>setConfig(p=>p?{...p,maksRader:parseInt(e.target.value)}:p)}
                  style={{ width:'100%', accentColor:'var(--gold)' }}/>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-muted)', marginTop:2 }}>
                  <span>5</span><span>200</span>
                </div>
              </div>

              {/* Reset */}
              <button type="button"
                onClick={() => {
                  const cols = forslag.data?.[0] ? Object.keys(forslag.data[0]) : [];
                  const x = forslag.xAkse ?? cols[0] ?? '';
                  const y = forslag.yAkse ?? cols[1] ?? cols[0] ?? '';
                  isFirstFetch.current = true;
                  setAktivData(forslag.data ?? []);
                  {
                    const parsed2 = parseFiltreTilObjekter(forslag.sql ?? '', forslag.prosjektFilter ?? '', forslag.prosjektKolonne);
                    const gyldigeKol2 = new Set((forslag.alleViewKolonner ?? []).map(k => k.kolonne_navn.toLowerCase()));
                    setAktiveFiltre(gyldigeKol2.size > 0 ? parsed2.filter(ff => gyldigeKol2.has(ff.kolonne.toLowerCase())) : parsed2);
                  }
                  setConfig({ visualType:forslag.visualType, xAkse:x, yAkse:y, aggregering:'SUM', grupperPaa:forslag.grupperPaa??null, ekstraKolonner:[], kombinertSerier:[], sorterPaa:null, sorterRetning:defaultSorterRetning(x), maksRader:50 });
                }}
                style={{ marginTop:4, padding:8, borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--glass-bg)', border:'1px solid var(--glass-border)', color:'var(--text-muted)' }}>
                Tilbakestill til AI-forslag
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
