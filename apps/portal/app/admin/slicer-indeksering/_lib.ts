/**
 * Felles typer og API-hjelpere for slicer-indeks-admin-sidene.
 *
 * Bruker glassmorphic dark-stil — matcher /admin/page.tsx (admin overview),
 * ikke den eldre lyse stil-en i /admin/workspaces.
 */

import { apiFetch } from '@/lib/apiClient';

export interface SlicerKonfigKort {
  id:                string;
  rapport_id:        string;
  rapport_navn:      string | null;
  slicer_tittel:     string;
  slicer_type:       'basic' | 'hierarchy';
  sist_indeksert:    string | null;
  sist_kjort:        string | null;
  sist_antall_rader: number | null;
  sist_feil:         string | null;
  er_aktiv:          boolean;
}

export interface SlicerKonfigDetalj extends SlicerKonfigKort {
  workspace_id:     string;
  dataset_id:       string;
  dax_query:        string;
  forelder_kolonne: string | null;
  verdi_kolonne:    string;
  // tenant-feltet kommer fra serveren via {...k} men brukes ikke av UI
  opprettet:        string;
  oppdatert:        string;
}

export interface RapportMedSlicereOversikt {
  id:                string;
  navn:              string;
  område:            string | null;
  pbiReportId:       string;
  pbiWorkspaceId:    string;
  pbiDatasetId:      string;
  antall_slicere:    number | null;
  antall_indekserte: number;
}

export interface ForslagRespons {
  merknad:               string;
  trenger_reindeksering: SlicerKonfigKort[];
  rapporter_uten_konfig: Array<{ id: string; navn: string; område: string | null }>;
}

export interface SchedulerStatus {
  aktiv:          boolean;
  cron_uttrykk:   string | null;
  tidssone:       string;
  neste_kjoring:  string | null;
  sist_kjoring:   string | null;
}

export interface IndekseringResultat {
  slicer_tittel: string;
  antall_rader:  number;
  dax_ms:        number;
  indeks_ms:     number;
}

export interface TabellKolonne {
  navn:            string;
  fully_qualified: string;
}

export type OpprettBody =
  | { rapport_id: string; slicer_tittel: string; slicer_type: 'basic';     tabell: string; verdi_kolonne: string }
  | { rapport_id: string; slicer_tittel: string; slicer_type: 'hierarchy'; tabell: string; verdi_kolonne: string; forelder_kolonne: string };

export interface OppdaterBody {
  slicer_type?:      'basic' | 'hierarchy';
  tabell?:           string;
  verdi_kolonne?:    string;
  forelder_kolonne?: string | null;
  er_aktiv?:         boolean;
}

// ── API-kall ───────────────────────────────────────────────────────────

function authHeaders(entraObjectId: string): Record<string, string> {
  return { 'X-Entra-Object-Id': entraObjectId };
}

async function håndter<T>(respons: Response): Promise<T> {
  if (!respons.ok) {
    let detail = '';
    try {
      const data = await respons.json() as { error?: string; detail?: string };
      detail = data.error ?? data.detail ?? '';
    } catch { /* ignorer */ }
    throw new Error(detail || `HTTP ${respons.status}`);
  }
  return respons.json() as Promise<T>;
}

export const adminApi = {
  list: (entraObjectId: string) =>
    apiFetch('/api/admin/slicer-indeks', { headers: authHeaders(entraObjectId) })
      .then(håndter<SlicerKonfigKort[]>),

  detalj: (entraObjectId: string, id: string) =>
    apiFetch(`/api/admin/slicer-indeks/${encodeURIComponent(id)}`, { headers: authHeaders(entraObjectId) })
      .then(håndter<SlicerKonfigDetalj>),

  opprett: (entraObjectId: string, body: OpprettBody) =>
    apiFetch('/api/admin/slicer-indeks', {
      method:  'POST',
      headers: { ...authHeaders(entraObjectId), 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }).then(håndter<SlicerKonfigDetalj>),

  oppdater: (entraObjectId: string, id: string, body: OppdaterBody) =>
    apiFetch(`/api/admin/slicer-indeks/${encodeURIComponent(id)}`, {
      method:  'PUT',
      headers: { ...authHeaders(entraObjectId), 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }).then(håndter<SlicerKonfigDetalj>),

  slett: (entraObjectId: string, id: string) =>
    apiFetch(`/api/admin/slicer-indeks/${encodeURIComponent(id)}`, {
      method:  'DELETE',
      headers: authHeaders(entraObjectId),
    }).then(håndter<{ slettet: boolean; indeks_dokumenter_slettet: number }>),

  indekser: (entraObjectId: string, id: string) =>
    apiFetch(`/api/admin/slicer-indeks/${encodeURIComponent(id)}/indekser`, {
      method:  'POST',
      headers: authHeaders(entraObjectId),
    }).then(håndter<IndekseringResultat>),

  rapporterMedSlicere: (entraObjectId: string) =>
    apiFetch('/api/admin/rapporter-med-slicere', { headers: authHeaders(entraObjectId) })
      .then(håndter<RapportMedSlicereOversikt[]>),

  forslag: (entraObjectId: string) =>
    apiFetch('/api/admin/slicer-indeks/forslag', { headers: authHeaders(entraObjectId) })
      .then(håndter<ForslagRespons>),

  schedulerStatus: (entraObjectId: string) =>
    apiFetch('/api/admin/slicer-indeks/scheduler-status', { headers: authHeaders(entraObjectId) })
      .then(håndter<SchedulerStatus>),

  hentKolonner: (entraObjectId: string, workspaceId: string, datasetId: string, tabell: string) =>
    apiFetch(
      `/api/admin/datasets/${encodeURIComponent(workspaceId)}/${encodeURIComponent(datasetId)}/tabeller?tabell=${encodeURIComponent(tabell)}`,
      { headers: authHeaders(entraObjectId) },
    ).then(håndter<{ tabell: string; kolonner: TabellKolonne[]; antall_rader?: number }>),
};

// ── Formatering ────────────────────────────────────────────────────────

export function formaterAlder(iso: string | null): string {
  if (!iso) return 'aldri';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1)  return 'nå nettopp';
  if (min < 60) return `${min}m siden`;
  const t = Math.floor(min / 60);
  if (t < 48)   return `${t}t siden`;
  return `${Math.floor(t / 24)}d siden`;
}
