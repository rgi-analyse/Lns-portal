import { models, type Report } from 'powerbi-client';
import { logger } from './logger';

// ─────────────────────────────────────────────
// Domene-typer (delt mellom UI, AI og PBI-laget)
// ─────────────────────────────────────────────

export type SlicerTittel = string;

export interface HierarchyLevel {
  verdi: string | number;
  /**
   * Udefinert eller tom array → "velg hele nivået under" (PBI: operator 'Selected').
   * Med innhold                → "velg kun disse barna" (PBI: operator 'Inherited' + children).
   *
   * Maks 3 nivåer (Year-Quarter-Month eller Year-Month-Day) i AI-tool-schema.
   * Power BI støtter dypere hierarkier — utvid schemaen hvis analysebehov dukker opp.
   */
  barn?: HierarchyLevel[];
}

export type SlicerConfig =
  | { tittel: SlicerTittel; type: 'basic';     verdier: (string | number)[] }
  | { tittel: SlicerTittel; type: 'hierarchy'; nivåer:  HierarchyLevel[] };

interface SlicerMeta {
  visualName: string;
  tittel:     SlicerTittel;
  /** True hvis sliceren er en dato-slicer (advanced/range-filter, ISO-verdier,
   *  eller dato-kolonne-navn). Brukes av set_date_filter-tool. */
  erDato:     boolean;
  /** Target for date-range filter (table + column). Settes når erDato=true.
   *  For hierarki-slicere: første target som har en column-egenskap. */
  dateTarget?: { table: string; column: string };
}

export interface BasicSlicerInfo extends SlicerMeta {
  type:        'basic';
  target:      { table: string; column: string } | null;
  kolonneType: 'string' | 'number';
  verdier:     string[];
}

/**
 * Target-shape for hierarki-slicere. PBI returnerer enten:
 *   - `{ table, column }`           — multi-kolonne-slicer (f.eks. Year + Month som separate kolonner)
 *   - `{ table, hierarchy, hierarchyLevel }` — slicer bundet til et navngitt date-hierarki
 * Vi lagrer hele objektet uendret slik at applyHierarchy kan returnere det til PBI som det kom.
 */
export interface HierarchyTarget {
  table:           string;
  column?:         string;
  hierarchy?:      string;
  hierarchyLevel?: string;
}

export interface HierarchySlicerInfo extends SlicerMeta {
  type:            'hierarchy';
  targets:         HierarchyTarget[];
  toppNivåVerdier: string[];
  barnPerForelder: Record<string, string[]>;
  /** Forventet datatype per nivå-dybde (0 = topp). Brukes til å konvertere
   *  AI-payload til riktig JSON-type før vi sender til PBI. */
  nivåTyper:       Array<'string' | 'number'>;
}

export type SlicerInfo = BasicSlicerInfo | HierarchySlicerInfo;
export type SlicerMapping = Record<SlicerTittel, string>;

export type SlicerSeleksjon =
  | { type: 'basic';     verdier: (string | number)[] }
  | { type: 'hierarchy'; nivåer:  HierarchyLevel[] }
  | null;

export type SlicerState = Record<SlicerTittel, SlicerSeleksjon>;

// ─────────────────────────────────────────────
// Hjelpere
// ─────────────────────────────────────────────

const HIERARCHY_FILTER_TYPE = models.FilterType.Hierarchy;
const SCHEMA_BASIC          = 'http://powerbi.com/product/schema#basic';
const SCHEMA_HIERARCHY      = 'http://powerbi.com/product/schema#hierarchy';

function erSlicerType(type: string): boolean {
  return type.toLowerCase().includes('slicer');
}

function parseCSVRad(linje: string): string[] {
  const celler: string[] = [];
  let inAnførsel = false;
  let curr = '';
  for (let i = 0; i < linje.length; i++) {
    const c = linje[i];
    if (c === '"') {
      if (inAnførsel && linje[i + 1] === '"') { curr += '"'; i++; }
      else inAnførsel = !inAnførsel;
    } else if (c === ',' && !inAnførsel) {
      celler.push(curr.trim());
      curr = '';
    } else {
      curr += c;
    }
  }
  celler.push(curr.trim());
  return celler.map((c) => c.replace(/^"|"$/g, ''));
}

function utledKolonneType(verdier: string[]): 'string' | 'number' {
  if (verdier.length === 0) return 'string';
  const numeriske = verdier.filter((v) => v !== '' && !isNaN(Number(v.replace(',', '.'))));
  return numeriske.length === verdier.length ? 'number' : 'string';
}

/**
 * Konverter en verdi til riktig JSON-type før vi sender til PBI.
 * PBI matcher ikke filterverdier mot data hvis JSON-typen er feil
 * (number vs string skiller). Brukes av både applyBasic og applyHierarchy.
 */
function tilPbiVerdi(verdi: string | number, kolonneType: 'string' | 'number'): string | number {
  if (kolonneType === 'number') {
    const n = typeof verdi === 'number' ? verdi : Number(String(verdi).replace(',', '.'));
    return Number.isFinite(n) ? n : verdi;
  }
  return typeof verdi === 'number' ? String(verdi) : verdi;
}

/** Rekursivt konverter verdier i hver nivå-node til riktig JSON-type basert på nivåTyper. */
function konverterNivåer(
  nivåer:    HierarchyLevel[],
  nivåTyper: Array<'string' | 'number'>,
  depth = 0,
): HierarchyLevel[] {
  const type = nivåTyper[depth] ?? 'string';
  return nivåer.map((n) => ({
    verdi: tilPbiVerdi(n.verdi, type),
    ...(n.barn ? { barn: konverterNivåer(n.barn, nivåTyper, depth + 1) } : {}),
  }));
}

function tilPbiHierarchyNode(level: HierarchyLevel): Record<string, unknown> {
  if (level.barn && level.barn.length > 0) {
    return {
      operator: 'Inherited',
      value:    level.verdi,
      children: level.barn.map((b) => tilPbiHierarchyNode(b)),
    };
  }
  // Inkluder children: [] eksplisitt — PBI er pirkete på dette feltet for løvnoder.
  return { operator: 'Selected', value: level.verdi, children: [] };
}

function fraPbiHierarchyNode(node: Record<string, unknown>): HierarchyLevel | null {
  const verdi = node['value'] as string | number | undefined;
  if (verdi === undefined) return null;
  const operator    = node['operator'] as string | undefined;
  const rawChildren = node['children'] as Array<Record<string, unknown>> | undefined;
  const valgteBarn  = rawChildren
    ?.filter((c) => c['operator'] === 'Selected')
    ?.map((c) => fraPbiHierarchyNode(c))
    ?.filter((b): b is HierarchyLevel => b !== null);

  if (operator === 'Inherited' && valgteBarn && valgteBarn.length > 0) {
    return { verdi, barn: valgteBarn };
  }
  return { verdi };
}

/**
 * Detekter om en slicer er dato-type med 3-trinns regelsett (i prioritert
 * rekkefølge — første match vinner):
 *
 *   1. Primær: eksisterende filter er advanced/range
 *      (state.filters[0].$schema inneholder "advanced" eller filterType===0)
 *   2. Sekundær: verdi-mønster matcher ISO-dato på minst 3 første verdier
 *   3. Tertiær: target.column eller table-navn matcher dato-heuristikk
 *
 * Returnerer { erDato, dateTarget, regel }. regel er kun for logging.
 */
function detekterErDato(args: {
  state:    { filters?: unknown[] } | null;
  targets:  HierarchyTarget[];
  verdier:  string[];
}): { erDato: boolean; dateTarget?: { table: string; column: string }; regel: string | null } {
  const { state, targets, verdier } = args;

  // Hjelper: hent første target som har en column-egenskap (kan brukes til
  // date-range filter mot en konkret kolonne).
  const førsteKolonneTarget = targets.find(
    (t): t is HierarchyTarget & { column: string } => typeof t.column === 'string',
  );
  const targetForRange = førsteKolonneTarget
    ? { table: førsteKolonneTarget.table, column: førsteKolonneTarget.column }
    : undefined;

  // Regel 1: eksisterende advanced/range-filter
  const filter0 = state?.filters?.[0] as { $schema?: unknown; filterType?: unknown } | undefined;
  if (filter0) {
    const schemaErAdvanced = typeof filter0.$schema === 'string' && filter0.$schema.includes('advanced');
    const erAdvancedFilterType = filter0.filterType === 0;
    if (schemaErAdvanced || erAdvancedFilterType) {
      return { erDato: true, dateTarget: targetForRange, regel: 'advanced-filter' };
    }
  }

  // Regel 2: verdi-mønster ISO-dato (sjekk første 3 ikke-tomme verdier)
  const ikkeTomme = verdier.filter((v) => v !== '');
  if (ikkeTomme.length >= 3) {
    const ISO_DATO = /^\d{4}-\d{2}-\d{2}/;
    const tre = ikkeTomme.slice(0, 3);
    if (tre.every((v) => ISO_DATO.test(v))) {
      return { erDato: true, dateTarget: targetForRange, regel: 'verdi-mønster' };
    }
  }

  // Regel 3: kolonne-navn-heuristikk
  const KOLONNE_RE = /^(date|dato|tid|periode)$/i;
  const TABLE_RE   = /^(tid|dato|date|calendar)/i;
  for (const t of targets) {
    const matchKolonne = typeof t.column === 'string' && KOLONNE_RE.test(t.column);
    const matchTable   = TABLE_RE.test(t.table);
    if (matchKolonne || matchTable) {
      return { erDato: true, dateTarget: targetForRange, regel: 'kolonne-navn' };
    }
  }

  return { erDato: false, regel: null };
}

async function finnAktivSide(report: Report) {
  const pages = await report.getPages();
  return pages.find((p) => p.isActive) ?? null;
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/** Leser alle slicere på aktiv side. Skal kalles ved 'loaded' og 'pageChanged'. */
export async function loadAll(report: Report): Promise<{
  slicere: SlicerInfo[];
  mapping: SlicerMapping;
}> {
  const aktiv = await finnAktivSide(report);
  if (!aktiv) return { slicere: [], mapping: {} };

  const visuals = await aktiv.getVisuals();
  const slicerVisuals = visuals.filter((v) => erSlicerType(v.type));

  const slicere: SlicerInfo[] = [];
  const mapping: SlicerMapping = {};

  for (const visual of slicerVisuals) {
    let targets: HierarchyTarget[] = [];
    let slicerState: { filters?: unknown[]; targets?: HierarchyTarget[] } | null = null;
    try {
      const state = await visual.getSlicerState();
      logger.debug(`[slicerOps] state for "${visual.title ?? visual.name}":`, JSON.stringify(state));
      slicerState = state as unknown as { filters?: unknown[]; targets?: HierarchyTarget[] };
      targets = slicerState.targets ?? [];
    } catch { /* slicer kan være tom — fortsett */ }

    // Hierarki = enten flere targets, eller ett target som bruker hierarchy/hierarchyLevel-felt
    const erHierarki = targets.length > 1
      || targets.some((t) => 'hierarchy' in t || 'hierarchyLevel' in t);
    const tittelRaw  = visual.title?.trim() ?? '';

    let headers: string[] = [];
    let dataLinjer: string[] = [];
    try {
      const exported = await visual.exportData(models.ExportDataType.Summarized);
      const linjer   = exported.data.split('\n').map((l: string) => l.trim()).filter(Boolean);
      headers     = linjer.length > 0 ? parseCSVRad(linjer[0]) : [];
      dataLinjer  = linjer.slice(1);
    } catch (err) {
      logger.warn(`[slicerOps] exportData feilet for "${tittelRaw || visual.name}":`, err);
    }

    // Tittel: bruk visual.title om satt og ikke generisk; ellers første kolonnenavn fra CSV.
    const trengerHeaderSomNøkkel = !tittelRaw || tittelRaw === 'Slicer';
    const tittel = trengerHeaderSomNøkkel ? (headers[0] ?? visual.name) : tittelRaw;

    mapping[tittel] = visual.name;

    // Detektér om sliceren er dato-type. Verdier brukes for hierarki-tilfellet
    // også (CSV-første-kolonne kan være ISO-datoer for date-hierarkier).
    const verdierForDeteksjon = dataLinjer.slice(0, 50)
      .map((l) => parseCSVRad(l)[0])
      .filter((v): v is string => v !== undefined && v !== '');
    const datoDeteksjon = detekterErDato({
      state:   slicerState,
      targets,
      verdier: verdierForDeteksjon,
    });
    if (datoDeteksjon.regel) {
      logger.debug(
        `[slicerOps] erDato-deteksjon "${tittel}": match via regel="${datoDeteksjon.regel}" ` +
        `(dateTarget=${datoDeteksjon.dateTarget ? `${datoDeteksjon.dateTarget.table}.${datoDeteksjon.dateTarget.column}` : '(mangler)'})`,
      );
    }

    if (erHierarki) {
      const toppSet         = new Set<string>();
      const barnPerForelder: Record<string, string[]> = {};
      for (const linje of dataLinjer.slice(0, 200)) {
        const cols = parseCSVRad(linje);
        if (cols.length < 2) continue;
        const topp = cols[0];
        const barn = cols[cols.length - 1];
        toppSet.add(topp);
        if (!barnPerForelder[topp]) barnPerForelder[topp] = [];
        if (!barnPerForelder[topp].includes(barn)) barnPerForelder[topp].push(barn);
      }

      // Utled type per nivå fra CSV-kolonnene. Tid-slicer har Year (number) + UkeTekst (string).
      // PBI er pirkete på JSON-typer i hierarchyData — value: 2026 ≠ value: "2026".
      const nivåTyper: Array<'string' | 'number'> = [];
      const numNivåer = headers.length;
      for (let kol = 0; kol < numNivåer; kol++) {
        const kolverdier = dataLinjer.slice(0, 50)
          .map((l) => parseCSVRad(l)[kol])
          .filter((v): v is string => v !== undefined && v !== '');
        const numeriske = kolverdier.filter((v) => !isNaN(Number(v.replace(',', '.'))));
        nivåTyper.push(
          kolverdier.length > 0 && numeriske.length === kolverdier.length ? 'number' : 'string',
        );
      }

      logger.debug(
        `[slicerOps] hierarchy "${tittel}": ${toppSet.size} forelder-noder, ` +
        `${Object.values(barnPerForelder).reduce((s, b) => s + b.length, 0)} barn totalt ` +
        `(${dataLinjer.length} CSV-rader, nivåTyper=[${nivåTyper.join(',')}])`,
      );
      slicere.push({
        type: 'hierarchy',
        visualName: visual.name,
        tittel,
        erDato: datoDeteksjon.erDato,
        ...(datoDeteksjon.dateTarget ? { dateTarget: datoDeteksjon.dateTarget } : {}),
        // Bevar hele target-shapen fra PBI — kan inneholde hierarchy/hierarchyLevel for date-hierarkier.
        targets: targets.map((t) => ({ ...t })),
        toppNivåVerdier: Array.from(toppSet),
        barnPerForelder,
        nivåTyper,
      });
    } else {
      const verdier = verdierForDeteksjon;
      logger.debug(
        `[slicerOps] basic "${tittel}": ${verdier.length} verdier ` +
        `(første 3: ${verdier.slice(0, 3).join(' | ')}${verdier.length > 3 ? ', …' : ''})`,
      );
      slicere.push({
        type: 'basic',
        visualName: visual.name,
        tittel,
        erDato: datoDeteksjon.erDato,
        ...(datoDeteksjon.dateTarget ? { dateTarget: datoDeteksjon.dateTarget } : {}),
        target: targets[0]?.column
          ? { table: targets[0].table, column: targets[0].column }
          : null,
        kolonneType: utledKolonneType(verdier),
        verdier,
      });
    }
  }

  return { slicere, mapping };
}

/** Aktivt state per slicer på aktiv side. */
export async function getActiveState(
  report:  Report,
  mapping: SlicerMapping,
  slicere: SlicerInfo[],
): Promise<SlicerState> {
  const aktiv = await finnAktivSide(report);
  if (!aktiv) return {};
  const visuals = await aktiv.getVisuals();

  const reverseMapping: Record<string, string> = {};
  for (const [tittel, visualName] of Object.entries(mapping)) {
    reverseMapping[visualName] = tittel;
  }

  const result: SlicerState = {};

  for (const visual of visuals) {
    if (!erSlicerType(visual.type)) continue;
    const tittel = reverseMapping[visual.name] ?? visual.title?.trim() ?? visual.name;
    const info   = slicere.find((s) => s.visualName === visual.name);

    let firstFilter: Record<string, unknown> | undefined;
    try {
      const state = await visual.getSlicerState();
      firstFilter = state.filters?.[0] as unknown as Record<string, unknown> | undefined;
    } catch {
      result[tittel] = null;
      continue;
    }

    if (!firstFilter) {
      result[tittel] = null;
      continue;
    }

    const erHierarki = info?.type === 'hierarchy' || firstFilter['filterType'] === HIERARCHY_FILTER_TYPE;

    if (erHierarki) {
      const hData = firstFilter['hierarchyData'] as Array<Record<string, unknown>> | undefined;
      const nivåer = hData
        ?.map((node) => fraPbiHierarchyNode(node))
        ?.filter((n): n is HierarchyLevel => n !== null);
      result[tittel] = nivåer && nivåer.length > 0 ? { type: 'hierarchy', nivåer } : null;
    } else if (Array.isArray(firstFilter['values'])) {
      result[tittel] = { type: 'basic', verdier: firstFilter['values'] as (string | number)[] };
    } else {
      result[tittel] = null;
    }
  }

  return result;
}

/** Setter en slicer iht. eksplisitt config. Throw'er med informativ feil ved problemer. */
export async function apply(
  report:  Report,
  mapping: SlicerMapping,
  slicere: SlicerInfo[],
  config:  SlicerConfig,
): Promise<void> {
  const visualName = mapping[config.tittel];
  if (!visualName) {
    const tilgjengelige = slicere.map((s) => s.tittel).join(', ') || '(ingen)';
    throw new Error(
      `Slicer "${config.tittel}" finnes ikke på aktiv side. ` +
      `Tilgjengelige: ${tilgjengelige}. Har siden nettopp blitt byttet?`,
    );
  }

  const info = slicere.find((s) => s.visualName === visualName);
  if (!info) {
    throw new Error(`Slicer "${config.tittel}" mangler info — kjør loadAll på nytt.`);
  }

  if (info.type !== config.type) {
    throw new Error(
      `Type-mismatch for slicer "${config.tittel}": faktisk type er "${info.type}", ` +
      `men config angir "${config.type}". ` +
      `${info.type === 'hierarchy' ? 'Bruk type=hierarchy med nivåer.' : 'Bruk type=basic med verdier.'}`,
    );
  }

  const aktiv = await finnAktivSide(report);
  if (!aktiv) throw new Error('Ingen aktiv side funnet i rapporten.');
  const visuals = await aktiv.getVisuals();
  const visual  = visuals.find((v) => v.name === visualName);
  if (!visual) {
    throw new Error(`Visual "${visualName}" for slicer "${config.tittel}" ikke funnet på aktiv side.`);
  }

  if (config.type === 'basic') {
    await applyBasic(visual, info as BasicSlicerInfo, config);
  } else {
    await applyHierarchy(visual, info as HierarchySlicerInfo, config);
  }
}

/** Tømmer en slicer. Idempotent. */
export async function clear(
  report:  Report,
  mapping: SlicerMapping,
  tittel:  SlicerTittel,
): Promise<void> {
  const visualName = mapping[tittel];
  if (!visualName) return; // idempotent — ikke en feil at sliceren ikke finnes
  const aktiv = await finnAktivSide(report);
  if (!aktiv) return;
  const visuals = await aktiv.getVisuals();
  const visual  = visuals.find((v) => v.name === visualName);
  if (!visual) return;
  await visual.setSlicerState({ filters: [] });
}

// ─────────────────────────────────────────────
// Private apply-grener
// ─────────────────────────────────────────────

async function applyBasic(
  visual: Awaited<ReturnType<Awaited<ReturnType<Report['getPages']>>[number]['getVisuals']>>[number],
  info:   BasicSlicerInfo,
  config: Extract<SlicerConfig, { type: 'basic' }>,
): Promise<void> {
  if (!info.target) {
    throw new Error(`Slicer "${info.tittel}" mangler target — kan ikke sette verdier.`);
  }

  const konverterte = config.verdier.map((v) => tilPbiVerdi(v, info.kolonneType));

  await visual.setSlicerState({
    filters: [{
      $schema:    SCHEMA_BASIC,
      target:     { table: info.target.table, column: info.target.column },
      filterType: models.FilterType.Basic,
      operator:   'In',
      values:     konverterte,
    }] as unknown as models.ISlicerFilter[],
  });
}

async function applyHierarchy(
  visual: Awaited<ReturnType<Awaited<ReturnType<Report['getPages']>>[number]['getVisuals']>>[number],
  info:   HierarchySlicerInfo,
  config: Extract<SlicerConfig, { type: 'hierarchy' }>,
): Promise<void> {
  if (info.targets.length === 0) {
    throw new Error(`Slicer "${info.tittel}" mangler targets — kan ikke sette hierarki.`);
  }
  if (config.nivåer.length === 0) {
    throw new Error(`Hierarchy-config for "${info.tittel}" må ha minst ett nivå.`);
  }

  // Konverter AI-payload til riktig JSON-type per nivå (Year=number, UkeTekst=string osv).
  // PBI matcher ikke filterverdier mot data hvis JSON-typen er feil.
  const konverterte   = konverterNivåer(config.nivåer, info.nivåTyper);
  const hierarchyData = konverterte.map((n) => tilPbiHierarchyNode(n));

  const filter = {
    $schema:       SCHEMA_HIERARCHY,
    target:        info.targets,
    filterType:    HIERARCHY_FILTER_TYPE,
    hierarchyData,
  };
  logger.debug(
    `[applyHierarchy] "${info.tittel}" nivåTyper=[${info.nivåTyper.join(',')}], ` +
    `payload:`, JSON.stringify({ filters: [filter] }, null, 2),
  );

  await visual.setSlicerState({
    filters: [filter] as unknown as models.ISlicerFilter[],
  });
}
