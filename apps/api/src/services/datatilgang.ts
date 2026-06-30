/**
 * Sentral datatilgang for AI-chat mot Azure SQL (ai_gold-views).
 *
 * SIKKERHETSPRINSIPP: FAIL-CLOSED. Kan ikke tilgang resolves → tom allow-list
 * (ingen datakilder), ALDRI "ingen begrensning". Kun admin/tenantadmin er
 * eksplisitt ubegrenset (mode:'admin').
 *
 * Tilgangsmodell (AI er opt-in per rapport):
 *   Bruker → workspaces → rapporter → views VIA EKSPLISITT ai_rapport_view_kobling
 *   Rapport uten kobling = ingen AI-datakilder for den rapporten (normal tilstand
 *   under utbredelse — ikke en feil).
 *
 *   - rapport-kontekst (rapportId satt): allow-list = den rapportens koblede views.
 *   - forside-kontekst (ingen rapportId): allow-list = union av alle rapportene
 *     brukeren har tilgang til.
 *
 * ai_rapport_view_kobling er per-tenant (rapport_id er tenant-lokal) → spørres mot
 * tenant-DB (dbUrl). ai_metadata_views er master-global → view-navn hentes derfra.
 */
import { queryAzureSQL, queryAzureSQLForTenant } from './azureSqlService';
import { logger } from '../lib/logger';

export type Datatilgang =
  | { mode: 'admin' }
  | { mode: 'begrenset'; tillatteViewIds: string[]; tillatteViewNavn: ReadonlySet<string> };

/** Tom (nektet) tilgang — fail-closed-standardverdi. */
export const INGEN_TILGANG: Datatilgang = {
  mode: 'begrenset',
  tillatteViewIds: [],
  tillatteViewNavn: new Set(),
};

// Løs strukturell type så en full PrismaClient (overloadet findMany) er tilordnbar.
interface TenantPrismaLike {
  workspace: { findMany: (args: any) => Promise<unknown> };
}
type WsRapportRad = { rapporter: { rapportId: string }[] };

export interface DatatilgangInput {
  /** True kun for admin/tenantadmin (kall erAdmin(rolle) hos kaller). */
  erAdminTilgang: boolean;
  entraObjectId?: string | null;
  grupper?: string[];
  tenantPrisma: TenantPrismaLike;
  dbUrl?: string | null;
}

// GUID/id-er til IN-klausuler: kun alfanumerisk + bindestrek (defense-in-depth
// utover at id-ene kommer fra DB, ikke bruker).
const reinId = (id: string): string => id.replace(/[^a-zA-Z0-9\-]/g, '');

/**
 * Resolver brukerens AI-datatilgang. Fail-closed: enhver feil/tom tilstand gir
 * INGEN_TILGANG, aldri ubegrenset. Kun erAdminTilgang gir mode:'admin'.
 */
export async function hentDatatilgang(
  input: DatatilgangInput,
  opts?: { rapportId?: string | null },
): Promise<Datatilgang> {
  if (input.erAdminTilgang) return { mode: 'admin' };

  const dbUrl = input.dbUrl ?? '';
  if (!dbUrl) return INGEN_TILGANG;

  try {
    // 1. Brukerens tilgjengelige rapporter = workspaces brukeren har TILGANG til
    //    (Tilgang-tabellen). IKKE opprettetAv — eierskap er ikke en tilgangsgrant.
    //    Samme mønster som search_portal_reports.
    const identities = [input.entraObjectId, ...(input.grupper ?? [])].filter(Boolean) as string[];
    if (identities.length === 0) return INGEN_TILGANG;

    const wsRapporter = await input.tenantPrisma.workspace.findMany({
      where: { tilgang: { some: { entraId: { in: identities } } } },
      select: { rapporter: { where: { rapport: { erAktiv: true } }, select: { rapportId: true } } },
    }) as WsRapportRad[];
    const tilgjengelige = new Set(wsRapporter.flatMap(w => w.rapporter.map(r => r.rapportId)));

    let rapportIds: string[];
    if (opts?.rapportId) {
      // Rapport-kontekst: kun hvis brukeren faktisk har tilgang til rapporten.
      // Verifiser mot tilgjengelige-settet — stol aldri på rapportId fra request (id-spoofing).
      rapportIds = tilgjengelige.has(opts.rapportId) ? [opts.rapportId] : [];
    } else {
      rapportIds = [...tilgjengelige];
    }
    if (rapportIds.length === 0) return INGEN_TILGANG;

    // 2. Eksplisitt koblede view-id-er (per-tenant)
    const rapportIn = rapportIds.map(id => `'${reinId(id)}'`).join(',');
    const koblinger = await queryAzureSQLForTenant(dbUrl, `
      SELECT DISTINCT view_id FROM ai_rapport_view_kobling WHERE rapport_id IN (${rapportIn})
    `);
    const koblede = koblinger.map(r => String(r['view_id'] ?? '')).filter(Boolean);
    if (koblede.length === 0) return INGEN_TILGANG;

    // 3. Aktive view-id + navn fra master-katalog (filtrerer bort inaktive/slettede)
    const viewIn = koblede.map(id => `'${reinId(id)}'`).join(',');
    const rader = await queryAzureSQL(`
      SELECT id, view_name FROM ai_metadata_views WHERE id IN (${viewIn}) AND er_aktiv = 1
    `);
    const tillatteViewIds = rader.map(r => String(r['id'] ?? '')).filter(Boolean);
    const tillatteViewNavn = new Set(
      rader.map(r => String(r['view_name'] ?? '').toLowerCase()).filter(Boolean),
    );
    if (tillatteViewIds.length === 0) return INGEN_TILGANG;

    return { mode: 'begrenset', tillatteViewIds, tillatteViewNavn };
  } catch (err) {
    // FAIL-CLOSED: feil i tilgangsoppslag → nekt, aldri allow-all.
    logger.warn('[datatilgang] kunne ikke resolve tilgang — fail-closed (tom allow-list):',
      err instanceof Error ? err.message : err);
    return INGEN_TILGANG;
  }
}

export interface SqlTilgangsResultat {
  ok: boolean;
  grunn?: 'ikke_select' | 'farlig_sql' | 'ikke_tillatt_view' | 'ukvalifisert_referanse';
  avvisteViews: string[];
}

// Skrive-/farlige operasjoner blokkeres for ALLE (også admin) — query-verktøyet er read-only.
const FARLIG_SQL = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|INTO|OPENROWSET|OPENQUERY|OPENDATASOURCE)\b|\b[sx]p_\w+/i;

/** Fjerner -- linjekommentarer og /* *​/ blokkommentarer før parsing. */
function stripKommentarer(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Validerer at en SQL-spørring er en trygg SELECT som kun refererer views
 * brukeren har tilgang til. Robust mot schema-kvalifiserte navn, CTE-er og
 * kommentarer. Fail-closed: ukjent/ukvalifisert referanse → avvis.
 */
export function validerSqlMotTilgang(sql: string, tilgang: Datatilgang): SqlTilgangsResultat {
  const rein = stripKommentarer(sql).trim().replace(/;\s*$/, '');

  // Flere setninger (stacked queries) → avvis
  if (rein.includes(';')) return { ok: false, grunn: 'farlig_sql', avvisteViews: [] };
  // Kun SELECT / WITH (CTE)
  if (!/^\s*(SELECT|WITH)\b/i.test(rein)) return { ok: false, grunn: 'ikke_select', avvisteViews: [] };
  // Skrive-/farlige nøkkelord — også for admin
  if (FARLIG_SQL.test(rein)) return { ok: false, grunn: 'farlig_sql', avvisteViews: [] };

  if (tilgang.mode === 'admin') return { ok: true, avvisteViews: [] };

  const lower = rein.toLowerCase();

  // Lovlige lokale CTE-navn (WITH x AS (...), kjedet , y AS (...))
  const cteNavn = new Set<string>();
  const cteRegex = /\b(?:with|,)\s+([a-zæøå0-9_]+)\s+as\s*\(/gi;
  for (let m = cteRegex.exec(lower); m; m = cteRegex.exec(lower)) cteNavn.add(m[1]);

  // Alle FROM/JOIN-mål. Norsk-safe tegnklasse (\w stopper ved æøå).
  const refRegex = /\b(?:from|join)\s+([a-zæøå0-9_]+)(?:\.([a-zæøå0-9_]+))?/gi;
  const avviste: string[] = [];
  for (let r = refRegex.exec(lower); r; r = refRegex.exec(lower)) {
    const schema = r[1];
    const view = r[2];
    if (view) {
      // schema-kvalifisert: kun ai_gold tillatt, og view må være i allow-lista
      if (schema !== 'ai_gold') { avviste.push(`${schema}.${view}`); continue; }
      if (!tilgang.tillatteViewNavn.has(view)) avviste.push(`ai_gold.${view}`);
    } else if (!cteNavn.has(schema)) {
      // ukvalifisert og ikke et CTE-navn → kan ikke valideres → avvis (fail-closed)
      return { ok: false, grunn: 'ukvalifisert_referanse', avvisteViews: [schema] };
    }
  }

  if (avviste.length > 0) {
    const harAnnetSchema = avviste.some(a => !a.startsWith('ai_gold.'));
    return {
      ok: false,
      grunn: harAnnetSchema ? 'ukvalifisert_referanse' : 'ikke_tillatt_view',
      avvisteViews: avviste,
    };
  }
  return { ok: true, avvisteViews: [] };
}
