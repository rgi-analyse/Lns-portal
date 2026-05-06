import { models, type Report } from 'powerbi-client';

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
    try {
      const state = await visual.getSlicerState();
      console.log(`[slicerOps] state for "${visual.title ?? visual.name}":`, JSON.stringify(state));
      const t = (state as unknown as { targets?: HierarchyTarget[] }).targets;
      targets = t ?? [];
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
      console.warn(`[slicerOps] exportData feilet for "${tittelRaw || visual.name}":`, err);
    }

    // Tittel: bruk visual.title om satt og ikke generisk; ellers første kolonnenavn fra CSV.
    const trengerHeaderSomNøkkel = !tittelRaw || tittelRaw === 'Slicer';
    const tittel = trengerHeaderSomNøkkel ? (headers[0] ?? visual.name) : tittelRaw;

    mapping[tittel] = visual.name;

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
      slicere.push({
        type: 'hierarchy',
        visualName: visual.name,
        tittel,
        // Bevar hele target-shapen fra PBI — kan inneholde hierarchy/hierarchyLevel for date-hierarkier.
        targets: targets.map((t) => ({ ...t })),
        toppNivåVerdier: Array.from(toppSet),
        barnPerForelder,
      });
    } else {
      const verdier = dataLinjer.slice(0, 50)
        .map((l) => parseCSVRad(l)[0])
        .filter((v): v is string => v !== undefined && v !== '');
      slicere.push({
        type: 'basic',
        visualName: visual.name,
        tittel,
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

  const konverterte = config.verdier.map((v) => {
    if (info.kolonneType === 'number') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      return Number.isFinite(n) ? n : v;
    }
    return typeof v === 'number' ? String(v) : v;
  });

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

  const hierarchyData = config.nivåer.map((n) => tilPbiHierarchyNode(n));

  const filter = {
    $schema:       SCHEMA_HIERARCHY,
    target:        info.targets,
    filterType:    HIERARCHY_FILTER_TYPE,
    hierarchyData,
  };
  console.log('[applyHierarchy] payload til PBI:', JSON.stringify({ filters: [filter] }, null, 2));

  await visual.setSlicerState({
    filters: [filter] as unknown as models.ISlicerFilter[],
  });
}
