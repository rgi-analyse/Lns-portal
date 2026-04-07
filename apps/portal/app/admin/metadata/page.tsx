'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Database, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useMsal } from '@azure/msal-react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/apiClient';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://localhost:3001';

interface Kolonne {
  id: string;
  view_id: string;
  kolonne_navn: string;
  datatype: string | null;
  beskrivelse: string | null;
  eksempel_verdier: string | null;
  er_filtrerbar: boolean;
  sort_order: number;
  kolonne_type: string;
  lenketekst: string | null;
}

const KOLONNE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  measure:  { label: 'Mål',       color: 'rgba(59,130,246,0.80)' },
  dimensjon:{ label: 'Dimensjon', color: 'var(--gold-dim)' },
  dato:     { label: 'Dato',      color: 'rgba(16,185,129,0.80)' },
  id:       { label: 'ID',        color: 'rgba(139,92,246,0.80)' },
  url:      { label: 'URL',       color: 'rgba(239,68,68,0.80)'  },
};

interface Eksempel {
  id: string;
  view_id: string;
  spørsmål: string | null;
  sql_eksempel: string | null;
}

interface Regel {
  id: string;
  view_id: string;
  regel: string;
}

interface MetadataView {
  id: string;
  schema_name: string;
  view_name: string;
  visningsnavn: string;
  beskrivelse: string | null;
  område: string | null;
  prosjekter: string | null;
  er_aktiv: boolean;
  sist_synkronisert: string | null;
  opprettet: string;
  prosjekt_kolonne: string | null;
  prosjekt_kolonne_type: string;
  kolonner: Kolonne[];
  eksempler: Eksempel[];
  regler: Regel[];
}

interface RapportItem {
  id: string;
  navn: string;
  område: string | null;
  workspace_navn: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MetadataAdminPage() {
  const { accounts } = useMsal();
  const entraObjectId = accounts[0]?.localAccountId ?? '';
  // Basisheaders uten Content-Type — legg til 'Content-Type': 'application/json' kun på kall med body
  const authHeaders: Record<string, string> = entraObjectId
    ? { 'X-Entra-Object-Id': entraObjectId }
    : {};
  const jsonHeaders = { ...authHeaders, 'Content-Type': 'application/json' };

  const [views, setViews] = useState<MetadataView[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [newViews, setNewViews] = useState<{ schema_name: string; view_name: string }[]>([]);
  const [addingView, setAddingView] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  // Dialog: edit view
  const [editView, setEditView] = useState<MetadataView | null>(null);
  const [editForm, setEditForm] = useState({ visningsnavn: '', beskrivelse: '', område: '', prosjekter: '', prosjekt_kolonne: '', prosjekt_kolonne_type: 'number', erAktiv: true });

  // Dialog: edit kolonne
  const [editKolonne, setEditKolonne] = useState<{ viewId: string; kol: Kolonne } | null>(null);
  const [kolForm, setKolForm] = useState({ beskrivelse: '', eksempel_verdier: '', lenketekst: '' });

  // Dialog: legg til eksempel
  const [addEksempelViewId, setAddEksempelViewId] = useState<string | null>(null);
  const [eksempelForm, setEksempelForm] = useState({ spørsmål: '', sql_eksempel: '' });

  // Dialog: legg til regel
  const [addRegelViewId, setAddRegelViewId] = useState<string | null>(null);
  const [regelForm, setRegelForm] = useState({ regel: '' });

  // Alle rapporter for dropdown
  const [alleRapporter, setAlleRapporter] = useState<RapportItem[]>([]);

  // Rapport-view koblinger (lazy-lastet per view)
  const [kobletRapporter, setKobletRapporter] = useState<Record<string, { rapport_id: string; prioritet: number }[]>>({});
  const [loadingKoblinger, setLoadingKoblinger] = useState<Set<string>>(new Set());
  const [addKoblingViewId, setAddKoblingViewId] = useState<string | null>(null);
  const [koblingForm, setKoblingForm] = useState({ rapportId: '', prioritet: '0' });

  const hentViews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/metadata/views', { headers: authHeaders });
      const data: unknown = await res.json();
      console.log('[Metadata] API respons:', data);
      setViews(Array.isArray(data) ? data : []);
    } catch {
      setStatusMsg('Feil ved henting av views');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entraObjectId]);

  useEffect(() => {
    hentViews();
    apiFetch('/api/admin/rapporter/alle', { headers: authHeaders })
      .then(r => r.json())
      .then((data: unknown) => setAlleRapporter(Array.isArray(data) ? data : []))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entraObjectId]);

  const hentKobletRapporter = async (viewId: string) => {
    setLoadingKoblinger(prev => new Set(prev).add(viewId));
    try {
      const res = await apiFetch(`/api/admin/metadata/views/${viewId}/rapporter`, { headers: authHeaders });
      const data = await res.json();
      setKobletRapporter(prev => ({ ...prev, [viewId]: Array.isArray(data) ? data : [] }));
    } catch {
      setKobletRapporter(prev => ({ ...prev, [viewId]: [] }));
    } finally {
      setLoadingKoblinger(prev => { const next = new Set(prev); next.delete(viewId); return next; });
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        if (!kobletRapporter[id]) hentKobletRapporter(id);
      }
      return next;
    });
  };

  const syncView = async (view: MetadataView) => {
    setSyncingId(view.id);
    setStatusMsg('');
    try {
      const res = await apiFetch(`/api/admin/metadata/views/${view.id}/sync`, {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await res.json();
      const oppdaterteKolonner = Array.isArray(data.kolonner) ? data.kolonner : [];
      setViews(prev => prev.map(v => v.id === view.id ? { ...v, kolonner: oppdaterteKolonner.length ? oppdaterteKolonner : v.kolonner, sist_synkronisert: new Date().toISOString() } : v));
      setStatusMsg(`Synkronisert ${view.view_name}: ${data.kolonner?.length ?? 0} kolonner`);
    } catch {
      setStatusMsg('Feil ved synkronisering');
    } finally {
      setSyncingId(null);
    }
  };

  const syncAll = async () => {
    setSyncingAll(true);
    setStatusMsg('');
    try {
      const res = await apiFetch('/api/admin/metadata/sync-all', { method: 'POST', headers: authHeaders });
      const data = await res.json();
      setStatusMsg(`Synkronisert ${data.synkronisert} views`);
      await hentViews();
    } catch {
      setStatusMsg('Feil ved synkronisering av alle views');
    } finally {
      setSyncingAll(false);
    }
  };

  const discover = async () => {
    setDiscovering(true);
    setStatusMsg('');
    try {
      const res = await apiFetch('/api/admin/metadata/discover', { headers: authHeaders });
      const data = await res.json();
      setNewViews(data.views ?? []);
      setStatusMsg(data.antall === 0 ? 'Ingen nye views funnet' : `${data.antall} nye views funnet`);
    } catch {
      setStatusMsg('Feil ved oppdagelse av views');
    } finally {
      setDiscovering(false);
    }
  };

  const leggTilView = async (schema_name: string, view_name: string) => {
    const key = `${schema_name}.${view_name}`;
    setAddingView(key);
    try {
      // Lag visningsnavn: fjern "vw_"-prefiks og erstatt _ med mellomrom
      const visningsnavn = view_name.replace(/^vw_/i, '').replace(/_/g, ' ');
      const res = await apiFetch('/api/admin/metadata/views', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ schema_name, view_name, visningsnavn, beskrivelse: '', område: '', prosjekter: 'alle' }),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error('[Metadata] feil ved legging til view:', txt);
        setStatusMsg(`Feil ved opprettelse av ${view_name}: ${res.status}`);
        return;
      }
      const data = await res.json();
      // Auto-sync for å hente kolonner automatisk
      await apiFetch(`/api/admin/metadata/views/${data.id}/sync`, {
        method: 'POST',
        headers: authHeaders,
      });
      // Fjern fra "nye views"-listen og refresh katalogen
      setNewViews(prev => prev.filter(v => !(v.schema_name === schema_name && v.view_name === view_name)));
      setStatusMsg(`${visningsnavn} lagt til og synkronisert`);
      await hentViews();
    } catch (err) {
      console.error('[Metadata] exception ved legging til view:', err);
      setStatusMsg(`Nettverksfeil ved opprettelse av ${view_name}`);
    } finally {
      setAddingView(null);
    }
  };

  const deaktiverView = async (id: string) => {
    if (!confirm('Deaktiver dette viewet?')) return;
    await apiFetch(`/api/admin/metadata/views/${id}`, { method: 'DELETE', headers: authHeaders });
    setViews(prev => prev.map(v => v.id === id ? { ...v, er_aktiv: false } : v));
  };

  // ── Edit view ──
  const åpneEditView = (view: MetadataView) => {
    setEditView(view);
    setEditForm({
      visningsnavn: view.visningsnavn,
      beskrivelse: view.beskrivelse ?? '',
      område: view.område ?? '',
      prosjekter: view.prosjekter ?? '',
      prosjekt_kolonne: view.prosjekt_kolonne ?? '',
      prosjekt_kolonne_type: view.prosjekt_kolonne_type ?? 'number',
      erAktiv: view.er_aktiv !== false,
    });
  };

  const lagreView = async () => {
    if (!editView) return;
    const res = await apiFetch(`/api/admin/metadata/views/${editView.id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({
        ...editForm,
        prosjekt_kolonne: editForm.prosjekt_kolonne || null,
        er_aktiv: editForm.erAktiv,
      }),
    });
    const updated = await res.json();
    setViews(prev => prev.map(v => v.id === editView.id ? { ...v, ...updated } : v));
    setEditView(null);
  };

  // ── Edit kolonne ──
  const åpneEditKolonne = (viewId: string, kol: Kolonne) => {
    setEditKolonne({ viewId, kol });
    setKolForm({ beskrivelse: kol.beskrivelse ?? '', eksempel_verdier: kol.eksempel_verdier ?? '', lenketekst: kol.lenketekst ?? '' });
  };

  const oppdaterKolonneType = async (viewId: string, kol: Kolonne, kolonne_type: string) => {
    // Optimistisk oppdatering i state
    setViews(prev => prev.map(v => v.id === viewId
      ? { ...v, kolonner: v.kolonner.map(k => k.id === kol.id ? { ...k, kolonne_type } : k) }
      : v,
    ));
    try {
      await apiFetch(`/api/admin/metadata/views/${viewId}/kolonner/${kol.id}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ kolonne_type }),
      });
    } catch {
      setStatusMsg(`Feil ved lagring av type for ${kol.kolonne_navn}`);
    }
  };

  const lagreKolonne = async () => {
    if (!editKolonne) return;
    const res = await apiFetch(`/api/admin/metadata/views/${editKolonne.viewId}/kolonner/${editKolonne.kol.id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(kolForm),
    });
    const updated = await res.json();
    setViews(prev => prev.map(v => v.id === editKolonne.viewId
      ? { ...v, kolonner: v.kolonner.map(k => k.id === editKolonne.kol.id ? { ...k, ...updated } : k) }
      : v,
    ));
    setEditKolonne(null);
  };

  // ── Eksempler ──
  const leggTilEksempel = async () => {
    if (!addEksempelViewId) return;
    const res = await apiFetch(`/api/admin/metadata/views/${addEksempelViewId}/eksempler`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(eksempelForm),
    });
    const ny = await res.json();
    setViews(prev => prev.map(v => v.id === addEksempelViewId ? { ...v, eksempler: [...v.eksempler, ny] } : v));
    setAddEksempelViewId(null);
    setEksempelForm({ spørsmål: '', sql_eksempel: '' });
  };

  const slettEksempel = async (viewId: string, eksId: string) => {
    await apiFetch(`/api/admin/metadata/views/${viewId}/eksempler/${eksId}`, { method: 'DELETE', headers: authHeaders });
    setViews(prev => prev.map(v => v.id === viewId ? { ...v, eksempler: v.eksempler.filter(e => e.id !== eksId) } : v));
  };

  // ── Regler ──
  const leggTilRegel = async () => {
    if (!addRegelViewId || !regelForm.regel.trim()) return;
    const res = await apiFetch(`/api/admin/metadata/views/${addRegelViewId}/regler`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(regelForm),
    });
    const ny = await res.json();
    setViews(prev => prev.map(v => v.id === addRegelViewId ? { ...v, regler: [...v.regler, ny] } : v));
    setAddRegelViewId(null);
    setRegelForm({ regel: '' });
  };

  const slettRegel = async (viewId: string, regelId: string) => {
    await apiFetch(`/api/admin/metadata/views/${viewId}/regler/${regelId}`, { method: 'DELETE', headers: authHeaders });
    setViews(prev => prev.map(v => v.id === viewId ? { ...v, regler: v.regler.filter(r => r.id !== regelId) } : v));
  };

  // ── Rapport-koblinger ──
  const leggTilKobling = async () => {
    if (!addKoblingViewId || !koblingForm.rapportId.trim()) return;
    const rapportId = koblingForm.rapportId.trim();
    await apiFetch(`/api/admin/metadata/rapport/${rapportId}/views`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ viewId: addKoblingViewId, prioritet: Number(koblingForm.prioritet) }),
    });
    setKobletRapporter(prev => ({
      ...prev,
      [addKoblingViewId]: [...(prev[addKoblingViewId] ?? []), { rapport_id: rapportId, prioritet: Number(koblingForm.prioritet) }],
    }));
    setAddKoblingViewId(null);
    setKoblingForm({ rapportId: '', prioritet: '0' });
  };

  const fjernKobling = async (viewId: string, rapportId: string) => {
    await apiFetch(`/api/admin/metadata/rapport/${rapportId}/views/${viewId}`, { method: 'DELETE', headers: authHeaders });
    setKobletRapporter(prev => ({ ...prev, [viewId]: (prev[viewId] ?? []).filter(k => k.rapport_id !== rapportId) }));
  };

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Metadata-katalog</h1>
          <p className="mt-1 text-sm text-gray-500">
            Administrer view-beskrivelser som brukes i AI-chat system prompt.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={discover}
            disabled={discovering}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium transition-colors disabled:opacity-50"
          >
            <Search className="w-4 h-4" />
            {discovering ? 'Søker…' : 'Oppdag nye views'}
          </button>
          <button
            onClick={syncAll}
            disabled={syncingAll}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncingAll ? 'animate-spin' : ''}`} />
            {syncingAll ? 'Synkroniserer…' : 'Synkroniser alle'}
          </button>
        </div>
      </div>

      {/* Status-melding */}
      {statusMsg && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-blue-50 border border-blue-100 text-sm text-blue-700">
          {statusMsg}
        </div>
      )}

      {/* Nye views oppdaget */}
      {newViews.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
          <p className="text-sm font-medium text-amber-800 px-4 pt-3 pb-2">
            {newViews.length} nye views funnet — ikke i katalogen ennå:
          </p>
          <div className="divide-y divide-amber-100">
            {newViews.map(v => {
              const key = `${v.schema_name}.${v.view_name}`;
              const isAdding = addingView === key;
              return (
                <div key={key} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm font-mono text-amber-700">{key}</span>
                  <button
                    onClick={() => leggTilView(v.schema_name, v.view_name)}
                    disabled={isAdding}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-amber-400 text-amber-700 bg-white hover:bg-amber-100 disabled:opacity-50 transition-colors shrink-0 ml-4"
                  >
                    {isAdding ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                    {isAdding ? 'Legger til…' : 'Legg til'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Views-liste */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Laster metadata…</div>
        ) : views.length === 0 ? (
          <div className="p-12 text-center">
            <Database className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Ingen views i katalogen. Kjør SQL-migrering først.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {views.map(view => {
              const isExpanded = expanded.has(view.id);
              return (
                <div key={view.id}>
                  {/* View-rad */}
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <button onClick={() => toggleExpand(view.id)} className="text-gray-400 hover:text-gray-600">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 text-sm">{view.visningsnavn}</span>
                        <Badge variant={view.er_aktiv ? 'default' : 'secondary'} className="text-xs">
                          {view.er_aktiv ? 'Aktiv' : 'Inaktiv'}
                        </Badge>
                        {view.område && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{view.område}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 font-mono mt-0.5">
                        {view.schema_name}.{view.view_name}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0">
                      <span>{view.kolonner.length} kolonner</span>
                      <span>{view.regler.length} regler</span>
                      <span>{view.eksempler.length} eksempler</span>
                      <span className="hidden sm:block">Synk: {formatDate(view.sist_synkronisert)}</span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => syncView(view)}
                        disabled={syncingId === view.id}
                        title="Synkroniser kolonner"
                        className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${syncingId === view.id ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={() => åpneEditView(view)}
                        className="px-3 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        Rediger
                      </button>
                      <button
                        onClick={() => deaktiverView(view.id)}
                        title="Deaktiver"
                        className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Ekspandert innhold */}
                  {isExpanded && (
                    <div className="bg-gray-50 border-t border-gray-100 px-8 pb-4 pt-3 space-y-4">

                      {/* Kolonner */}
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Kolonner ({view.kolonner.length})
                        </h4>
                        {view.kolonner.length === 0 ? (
                          <p className="text-xs text-gray-400">Ingen kolonner. Klikk synkroniser-knappen for å hente fra databasen.</p>
                        ) : (
                          <div className="space-y-1">
                            {view.kolonner.map(kol => {
                              const typeInfo = KOLONNE_TYPE_LABELS[kol.kolonne_type] ?? KOLONNE_TYPE_LABELS['dimensjon'];
                              return (
                                <div key={kol.id} className="flex items-start gap-3 text-xs bg-white rounded border border-gray-100 px-3 py-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-mono font-medium text-gray-800">{kol.kolonne_navn}</span>
                                      <span className="text-gray-400">({kol.datatype ?? '?'})</span>
                                      <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4, background:`${typeInfo.color}22`, color:typeInfo.color, border:`1px solid ${typeInfo.color}55`, letterSpacing:'0.05em', textTransform:'uppercase' }}>
                                        {typeInfo.label}
                                      </span>
                                      <select
                                        value={kol.kolonne_type ?? 'dimensjon'}
                                        onChange={e => oppdaterKolonneType(view.id, kol, e.target.value)}
                                        style={{ fontSize:10, padding:'1px 4px', borderRadius:4, background:'var(--glass-bg)', border:'1px solid var(--glass-border)', color:'var(--text-secondary)', cursor:'pointer' }}
                                        title="Endre kolonnetype"
                                      >
                                        <option value="dimensjon">Dimensjon</option>
                                        <option value="measure">Mål</option>
                                        <option value="dato">Dato</option>
                                        <option value="id">ID</option>
                                        <option value="url">URL</option>
                                      </select>
                                    </div>
                                    {kol.beskrivelse && <span className="text-gray-600 mt-0.5 block">— {kol.beskrivelse}</span>}
                                    {kol.eksempel_verdier && (
                                      <div className="mt-0.5 text-gray-400">
                                        Verdier: <span className="text-gray-600">{kol.eksempel_verdier}</span>
                                      </div>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => åpneEditKolonne(view.id, kol)}
                                    className="shrink-0 text-gray-400 hover:text-blue-600 text-xs underline"
                                  >
                                    Rediger
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Regler */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Regler ({view.regler.length})
                          </h4>
                          <button
                            onClick={() => { setAddRegelViewId(view.id); setRegelForm({ regel: '' }); }}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                          >
                            <Plus className="w-3 h-3" /> Legg til
                          </button>
                        </div>
                        {view.regler.length === 0 ? (
                          <p className="text-xs text-gray-400">Ingen regler definert.</p>
                        ) : (
                          <div className="space-y-1">
                            {view.regler.map(r => (
                              <div key={r.id} className="flex items-start gap-2 text-xs bg-white rounded border border-gray-100 px-3 py-2">
                                <span className="flex-1 text-gray-700">{r.regel}</span>
                                <button
                                  onClick={() => slettRegel(view.id, r.id)}
                                  className="shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Eksempler */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Eksempelspørringer ({view.eksempler.length})
                          </h4>
                          <button
                            onClick={() => { setAddEksempelViewId(view.id); setEksempelForm({ spørsmål: '', sql_eksempel: '' }); }}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                          >
                            <Plus className="w-3 h-3" /> Legg til
                          </button>
                        </div>
                        {view.eksempler.length === 0 ? (
                          <p className="text-xs text-gray-400">Ingen eksempler definert.</p>
                        ) : (
                          <div className="space-y-2">
                            {view.eksempler.map(e => (
                              <div key={e.id} className="text-xs bg-white rounded border border-gray-100 px-3 py-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    {e.spørsmål && <p className="text-gray-600 mb-1">— {e.spørsmål}</p>}
                                    {e.sql_eksempel && (
                                      <pre className="font-mono text-gray-700 bg-gray-50 rounded px-2 py-1 overflow-x-auto text-[11px]">
                                        {e.sql_eksempel}
                                      </pre>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => slettEksempel(view.id, e.id)}
                                    className="shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Koblede rapporter */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Koblede rapporter {kobletRapporter[view.id] ? `(${kobletRapporter[view.id].length})` : ''}
                          </h4>
                          <button
                            onClick={() => { setAddKoblingViewId(view.id); setKoblingForm({ rapportId: '', prioritet: '0' }); }}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                          >
                            <Plus className="w-3 h-3" /> Koble rapport
                          </button>
                        </div>
                        {loadingKoblinger.has(view.id) ? (
                          <p className="text-xs text-gray-400">Laster…</p>
                        ) : (kobletRapporter[view.id] ?? []).length === 0 ? (
                          <p className="text-xs text-gray-400">Ikke koblet til noen rapporter. AI bruker område-filter.</p>
                        ) : (
                          <div className="space-y-1">
                            {kobletRapporter[view.id].map(k => {
                              const rap = alleRapporter.find(r => r.id === k.rapport_id);
                              return (
                                <div key={k.rapport_id} className="flex items-center gap-2 text-xs bg-white rounded border border-gray-100 px-3 py-2">
                                  <div className="flex-1 min-w-0">
                                    <span className="font-medium text-gray-800">{rap?.navn ?? k.rapport_id}</span>
                                    {rap?.workspace_navn && <span className="ml-1.5 text-gray-400">— {rap.workspace_navn}</span>}
                                  </div>
                                  <span className="text-gray-400 shrink-0">prio: {k.prioritet}</span>
                                  <button
                                    onClick={() => fjernKobling(view.id, k.rapport_id)}
                                    className="shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dialog: Rediger view */}
      <Dialog
        open={!!editView}
        onClose={() => setEditView(null)}
        title={`Rediger: ${editView?.view_name ?? ''}`}
        className="max-w-lg"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Visningsnavn</label>
            <input
              value={editForm.visningsnavn}
              onChange={e => setEditForm(f => ({ ...f, visningsnavn: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Beskrivelse</label>
            <textarea
              value={editForm.beskrivelse}
              onChange={e => setEditForm(f => ({ ...f, beskrivelse: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Område</label>
            <input
              value={editForm.område}
              onChange={e => setEditForm(f => ({ ...f, område: e.target.value }))}
              placeholder="f.eks. HMS, Produksjon"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Prosjekter</label>
            <input
              value={editForm.prosjekter}
              onChange={e => setEditForm(f => ({ ...f, prosjekter: e.target.value }))}
              placeholder="alle  eller  4200,6040,6050"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Prosjektfilter-kolonne</label>
            <div className="flex gap-2">
              <select
                value={editForm.prosjekt_kolonne}
                onChange={e => setEditForm(f => ({ ...f, prosjekt_kolonne: e.target.value }))}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              >
                <option value="">Ingen (globalt view)</option>
                {(editView?.kolonner ?? []).map(k => (
                  <option key={k.kolonne_navn} value={k.kolonne_navn}>
                    {k.kolonne_navn} ({k.datatype ?? '?'})
                  </option>
                ))}
              </select>
              <select
                value={editForm.prosjekt_kolonne_type}
                onChange={e => setEditForm(f => ({ ...f, prosjekt_kolonne_type: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              >
                <option value="number">Nummer (= 6050)</option>
                <option value="string">Tekst (LIKE %6050%)</option>
                <option value="name">Navn (LIKE %Hemsil%)</option>
              </select>
            </div>
            {editForm.prosjekt_kolonne && (
              <p className="text-xs text-gray-400 mt-1 font-mono">
                WHERE [{editForm.prosjekt_kolonne}]
                {editForm.prosjekt_kolonne_type === 'number' ? ' = [prosjektnr]' : " LIKE '%[søk]%'"}
              </p>
            )}
          </div>

          {/* Aktiv/Inaktiv-toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: 8,
            background: 'var(--glass-bg-hover)',
          }}>
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>Aktiv</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                Inaktive views vises ikke i AI-chat eller rapport-designer
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditForm(f => ({ ...f, erAktiv: !f.erAktiv }))}
              style={{
                width: 40, height: 22, borderRadius: 11,
                border: 'none', cursor: 'pointer',
                position: 'relative', transition: 'background 0.2s',
                background: editForm.erAktiv ? 'var(--gold)' : 'var(--glass-border)',
                flexShrink: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: 3,
                left: editForm.erAktiv ? 20 : 3,
                width: 16, height: 16, borderRadius: '50%',
                background: 'white', transition: 'left 0.2s',
              }} />
            </button>
          </div>
        </div>
        <DialogFooter>
          <button onClick={() => setEditView(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">Avbryt</button>
          <button onClick={lagreView} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium transition-colors">Lagre</button>
        </DialogFooter>
      </Dialog>

      {/* Dialog: Rediger kolonne */}
      <Dialog
        open={!!editKolonne}
        onClose={() => setEditKolonne(null)}
        title={`Kolonne: ${editKolonne?.kol.kolonne_navn ?? ''}`}
        className="max-w-lg"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Beskrivelse</label>
            <textarea
              value={kolForm.beskrivelse}
              onChange={e => {
                setKolForm(f => ({ ...f, beskrivelse: e.target.value }));
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
              placeholder="Forklaring av kolonnen til AI"
              rows={1}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{ resize: 'none', overflow: 'hidden', lineHeight: '1.5' }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Eksempelverdier</label>
            <input
              value={kolForm.eksempel_verdier}
              onChange={e => setKolForm(f => ({ ...f, eksempel_verdier: e.target.value }))}
              placeholder="f.eks. Alvorlig, Mindre alvorlig, Svært alvorlig"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-gray-400 mt-1">Kommaseparert liste. Fylles automatisk ved synkronisering for kolonner med færre enn 20 unike verdier.</p>
          </div>
          {editKolonne?.kol.kolonne_type === 'url' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Lenketekst</label>
              <input
                value={kolForm.lenketekst}
                onChange={e => setKolForm(f => ({ ...f, lenketekst: e.target.value }))}
                placeholder="f.eks. Åpne dokument"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <p className="text-xs text-gray-400 mt-1">Tekst som vises i stedet for rå URL i AI-chat.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <button onClick={() => setEditKolonne(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">Avbryt</button>
          <button onClick={lagreKolonne} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium transition-colors">Lagre</button>
        </DialogFooter>
      </Dialog>

      {/* Dialog: Legg til eksempel */}
      <Dialog
        open={!!addEksempelViewId}
        onClose={() => setAddEksempelViewId(null)}
        title="Legg til eksempelspørring"
        className="max-w-xl"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Spørsmål (naturlig språk)</label>
            <input
              value={eksempelForm.spørsmål}
              onChange={e => setEksempelForm(f => ({ ...f, spørsmål: e.target.value }))}
              placeholder="f.eks. Hvor mange RUH ble registrert i mars 2026?"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">SQL-eksempel</label>
            <textarea
              value={eksempelForm.sql_eksempel}
              onChange={e => setEksempelForm(f => ({ ...f, sql_eksempel: e.target.value }))}
              rows={4}
              placeholder="SELECT COUNT(*) FROM ai_gold.vw_Fact_RUH WHERE år = 2026 AND måned = 3"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>
        <DialogFooter>
          <button onClick={() => setAddEksempelViewId(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">Avbryt</button>
          <button onClick={leggTilEksempel} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium transition-colors">Legg til</button>
        </DialogFooter>
      </Dialog>

      {/* Dialog: Legg til regel */}
      <Dialog
        open={!!addRegelViewId}
        onClose={() => setAddRegelViewId(null)}
        title="Legg til regel"
        className="max-w-lg"
      >
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Regel</label>
          <textarea
            value={regelForm.regel}
            onChange={e => setRegelForm({ regel: e.target.value })}
            rows={3}
            placeholder="f.eks. Bruk alltid LIKE for Prosjekt-kolonnen: WHERE Prosjekt LIKE '%søkeord%'"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            autoFocus
          />
        </div>
        <DialogFooter>
          <button onClick={() => setAddRegelViewId(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">Avbryt</button>
          <button onClick={leggTilRegel} disabled={!regelForm.regel.trim()} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 font-medium transition-colors">Legg til</button>
        </DialogFooter>
      </Dialog>

      {/* Dialog: Koble rapport til view */}
      <Dialog
        open={!!addKoblingViewId}
        onClose={() => setAddKoblingViewId(null)}
        title="Koble rapport til view"
        className="max-w-lg"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Rapport</label>
            <select
              value={koblingForm.rapportId}
              onChange={e => setKoblingForm(f => ({ ...f, rapportId: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              autoFocus
            >
              <option value="">Velg rapport...</option>
              {alleRapporter.map(r => (
                <option key={r.id} value={r.id}>
                  {r.navn}{r.workspace_navn ? ` — ${r.workspace_navn}` : ''}{r.område ? ` (${r.område})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Prioritet</label>
            <select
              value={koblingForm.prioritet}
              onChange={e => setKoblingForm(f => ({ ...f, prioritet: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            >
              <option value="1">1 — Primær</option>
              <option value="2">2 — Sekundær</option>
              <option value="0">0 — Standard</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <button onClick={() => setAddKoblingViewId(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">Avbryt</button>
          <button onClick={leggTilKobling} disabled={!koblingForm.rapportId.trim()} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 font-medium transition-colors">Koble</button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
