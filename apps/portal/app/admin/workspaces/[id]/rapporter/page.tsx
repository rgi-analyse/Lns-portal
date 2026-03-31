'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Shield, Trash2, Pencil, Search, FileBarChart, EyeOff, Link2 } from 'lucide-react';
import { useMsal } from '@azure/msal-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import PBIRapportBrowser from '@/components/PBIRapportBrowser';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import TilgangStyring from '@/components/TilgangStyring';
import { apiFetch } from '@/lib/apiClient';

interface Rapport {
  id: string;
  navn: string;
  område: string | null;
  beskrivelse: string | null;
  nøkkelord: string | null;
  pbiReportId: string;
  pbiDatasetId: string;
  pbiWorkspaceId: string;
}

interface AlleRapporter {
  id: string;
  navn: string;
  beskrivelse: string | null;
}

interface Workspace {
  id: string;
  navn: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function WorkspaceRapporterPage() {
  const { id } = useParams<{ id: string }>();
  const { accounts } = useMsal();
  const entraObjectId = accounts[0]?.localAccountId ?? '';
  const metaHeaders: Record<string, string> = entraObjectId
    ? { 'X-Entra-Object-Id': entraObjectId }
    : {};
  const metaJsonHeaders = { ...metaHeaders, 'Content-Type': 'application/json' };

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [rapporter, setRapporter] = useState<Rapport[]>([]);
  const [loading, setLoading]     = useState(true);

  const [pickerOpen, setPickerOpen]         = useState(false);
  const [alleRapporter, setAlleRapporter]   = useState<AlleRapporter[]>([]);
  const [alleLoading, setAlleLoading]       = useState(false);
  const [pickerSøk, setPickerSøk]           = useState('');
  const [linkingId, setLinkingId]           = useState<string | null>(null);

  const [unlinkId, setUnlinkId]   = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  const [tilgangRapport, setTilgangRapport] = useState<{ id: string; navn: string } | null>(null);

  const [pbiOpen, setPbiOpen] = useState(false);

  const [deaktiverId, setDeaktiverLId]   = useState<string | null>(null);
  const [deaktiverer, setDeaktiverer]    = useState(false);

  const [editRapport, setEditRapport] = useState<Rapport | null>(null);
  const [editForm, setEditForm] = useState({ navn: '', område: '', beskrivelse: '', nøkkelord: '' });
  const [saving, setSaving] = useState(false);

  // AI-view kobling
  const [aiKoblingRapport, setAiKoblingRapport] = useState<Rapport | null>(null);
  const [aiViews, setAiViews] = useState<{ id: string; visningsnavn: string; område: string | null }[]>([]);
  const [kobletViews, setKobletViews] = useState<{ view_id: string; prioritet: number; visningsnavn: string; beskrivelse: string | null; område: string | null }[]>([]);
  const [aiLoadingKobling, setAiLoadingKobling] = useState(false);
  const [nyViewId, setNyViewId] = useState('');
  const [nyPrioritet, setNyPrioritet] = useState(1);

  const fetchData = useCallback(async () => {
    if (!id) return;
    console.log('[RapporterPage] API URL:', process.env.NEXT_PUBLIC_API_URL);
    setLoading(true);
    try {
      const wsUrl = `/api/workspaces/${id}`;
      console.log('[RapporterPage] Henter workspace:', wsUrl);
      const wsRes = await apiFetch(wsUrl);
      console.log('[RapporterPage] Workspace response status:', wsRes.status);
      if (!wsRes.ok) {
        const body = await wsRes.text();
        console.error('[RapporterPage] Feil fra API (workspace):', body);
        throw new Error(`HTTP ${wsRes.status}`);
      }
      const ws = await wsRes.json() as Workspace;

      const rapUrl = `/api/workspaces/${id}/rapporter`;
      console.log('[RapporterPage] Henter rapporter:', rapUrl);
      const rapRes = await apiFetch(rapUrl);
      console.log('[RapporterPage] Rapporter response status:', rapRes.status);
      if (!rapRes.ok) {
        const body = await rapRes.text();
        console.error('[RapporterPage] Feil fra API (rapporter):', body);
        throw new Error(`HTTP ${rapRes.status}`);
      }
      const rListRaw = await rapRes.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rList: Rapport[] = (Array.isArray(rListRaw) ? rListRaw : []).map((r: any) => r.rapport ?? r);
      console.log('[RapporterPage] rListRaw:', rListRaw);
      console.log('[RapporterPage] rList etter mapping:', rList);
      setWorkspace(ws);
      setRapporter(rList);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ukjent feil';
      console.error('[RapporterPage] feil ved henting av data:', msg);
      toast({ title: 'Kunne ikke laste data', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Fjern kobling (sletter IKKE selve rapporten) ────────────────────────────

  const handleUnlink = async () => {
    if (!unlinkId) return;
    setUnlinking(true);
    try {
      const r = await apiFetch(`/api/workspaces/${id}/rapporter/${unlinkId}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 204) throw new Error();
      toast({ title: 'Rapport fjernet fra workspace', variant: 'success' });
      setUnlinkId(null);
      fetchData();
    } catch {
      toast({ title: 'Kunne ikke fjerne rapport', variant: 'destructive' });
    } finally {
      setUnlinking(false);
    }
  };

  const toUnlink = rapporter.find((r) => r.id === unlinkId);

  // ── Fjern fra portal (soft delete — setter erAktiv = false) ─────────────────

  const handleDeaktiver = async () => {
    if (!deaktiverId) return;
    setDeaktiverer(true);
    try {
      const r = await apiFetch(`/api/admin/rapporter/${deaktiverId}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 204) throw new Error();
      toast({ title: 'Rapport fjernet fra portalen', variant: 'success' });
      setDeaktiverLId(null);
      fetchData();
    } catch {
      toast({ title: 'Kunne ikke fjerne rapport fra portalen', variant: 'destructive' });
    } finally {
      setDeaktiverer(false);
    }
  };

  const toDeaktiver = rapporter.find((r) => r.id === deaktiverId);

  const startEdit = (rapport: Rapport) => {
    setEditRapport(rapport);
    setEditForm({
      navn:        rapport.navn,
      område:      rapport.område ?? '',
      beskrivelse: rapport.beskrivelse ?? '',
      nøkkelord:   rapport.nøkkelord ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editRapport || !editForm.navn.trim() || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/rapporter/${editRapport.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          navn:        editForm.navn.trim(),
          område:      editForm.område.trim() || null,
          beskrivelse: editForm.beskrivelse.trim() || null,
          nøkkelord:   editForm.nøkkelord.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const oppdatert = await res.json() as Rapport;
      setRapporter((prev) => prev.map((r) => r.id === oppdatert.id ? oppdatert : r));
      toast({ title: 'Rapport oppdatert', variant: 'success' });
      setEditRapport(null);
    } catch {
      toast({ title: 'Kunne ikke lagre endringer', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const åpneAiKobling = async (rapport: Rapport) => {
    setAiKoblingRapport(rapport);
    setNyViewId('');
    setNyPrioritet(1);
    setAiLoadingKobling(true);
    try {
      const [viewsRes, koblingRes] = await Promise.all([
        apiFetch('/api/admin/metadata/views', { headers: metaHeaders }),
        apiFetch(`/api/admin/metadata/rapport/${rapport.id}/views`, { headers: metaHeaders }),
      ]);
      const [views, koblinger] = await Promise.all([viewsRes.json(), koblingRes.json()]);
      setAiViews(Array.isArray(views) ? views : []);
      setKobletViews(Array.isArray(koblinger) ? koblinger : []);
    } catch {
      // ignore
    } finally {
      setAiLoadingKobling(false);
    }
  };

  const leggTilAiKobling = async () => {
    if (!aiKoblingRapport || !nyViewId) return;
    console.log('[AiKobling] POST rapport:', aiKoblingRapport.id, 'view:', nyViewId, 'prioritet:', nyPrioritet);
    try {
      const res = await apiFetch(`/api/admin/metadata/rapport/${aiKoblingRapport.id}/views`, {
        method: 'POST',
        headers: metaJsonHeaders,
        body: JSON.stringify({ viewId: nyViewId, prioritet: nyPrioritet }),
      });
      console.log('[AiKobling] POST svar:', res.status, res.statusText);
      if (!res.ok) {
        const txt = await res.text();
        console.error('[AiKobling] POST feilet:', txt);
        toast({ title: `Kunne ikke lagre kobling (${res.status})`, variant: 'destructive' });
        return;
      }
      setNyViewId('');
      // Re-hent fra DB for å vise korrekt lagret state
      await åpneAiKobling(aiKoblingRapport);
    } catch (err) {
      console.error('[AiKobling] POST exception:', err);
      toast({ title: 'Nettverksfeil ved lagring av kobling', variant: 'destructive' });
    }
  };

  const fjernAiKobling = async (viewId: string) => {
    if (!aiKoblingRapport) return;
    console.log('[AiKobling] DELETE rapport:', aiKoblingRapport.id, 'view:', viewId);
    try {
      const res = await apiFetch(`/api/admin/metadata/rapport/${aiKoblingRapport.id}/views/${viewId}`, { method: 'DELETE', headers: metaHeaders });
      console.log('[AiKobling] DELETE svar:', res.status);
      if (!res.ok) {
        toast({ title: `Kunne ikke fjerne kobling (${res.status})`, variant: 'destructive' });
        return;
      }
      setKobletViews(prev => prev.filter(v => v.view_id !== viewId));
    } catch (err) {
      console.error('[AiKobling] DELETE exception:', err);
      toast({ title: 'Nettverksfeil ved fjerning av kobling', variant: 'destructive' });
    }
  };

  const åpnePicker = () => {
    setPickerOpen(true);
    setPickerSøk('');
    setAlleLoading(true);
    apiFetch('/api/rapporter')
      .then((r) => r.json() as Promise<AlleRapporter[]>)
      .then((data) => setAlleRapporter(Array.isArray(data) ? data : []))
      .catch(() => toast({ title: 'Kunne ikke hente rapporter', variant: 'destructive' }))
      .finally(() => setAlleLoading(false));
  };

  const handleLinkRapport = async (rapportId: string) => {
    setLinkingId(rapportId);
    try {
      const r = await apiFetch(`/api/workspaces/${id}/rapporter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rapportId }),
      });
      if (!r.ok) {
        const data = await r.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      toast({ title: 'Rapport koblet til workspace', variant: 'success' });
      setPickerOpen(false);
      fetchData();
    } catch (err) {
      toast({
        title: 'Kunne ikke legge til rapport',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setLinkingId(null);
    }
  };

  const linkedIds = useMemo(() => new Set(rapporter.map((r) => r.id)), [rapporter]);

  const filtrerteRapporter = useMemo(() => {
    const q = pickerSøk.toLowerCase();
    return alleRapporter.filter(
      (r) => !linkedIds.has(r.id) && r.navn.toLowerCase().includes(q),
    );
  }, [alleRapporter, linkedIds, pickerSøk]);

  return (
    <div className="p-8">
      <Link
        href="/admin/workspaces"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Tilbake til workspaces
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {loading ? <Skeleton className="h-7 w-48 inline-block" /> : workspace?.navn}
            {!loading && (
              <Badge variant="secondary" className="ml-2 align-middle text-sm">
                {rapporter.length} rapporter
              </Badge>
            )}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Administrer rapporter i dette workspacet. Sletting fjerner kun koblingen.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={åpnePicker}>
            <Plus className="w-4 h-4" /> Koble eksisterende
          </Button>
          <Button size="sm" onClick={() => setPbiOpen(true)}>
            <Plus className="w-4 h-4" /> Fra Power BI
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Navn</TableHead>
              <TableHead>PBI Report ID</TableHead>
              <TableHead>PBI Dataset ID</TableHead>
              <TableHead className="text-right w-32">Handlinger</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 4 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : rapporter.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-gray-400 py-10">
                  Ingen rapporter koblet til dette workspacet.
                </TableCell>
              </TableRow>
            ) : (
              rapporter.map((rapport) => (
                <TableRow key={rapport.id}>
                  <TableCell className="font-medium text-gray-900">
                    <div>
                      <span>{rapport.navn}</span>
                      {rapport.område && (
                        <span className="ml-2 text-xs text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">{rapport.område}</span>
                      )}
                      {rapport.beskrivelse && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{rapport.beskrivelse}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-gray-500">{rapport.pbiReportId}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-gray-500">{rapport.pbiDatasetId}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Tooltip content="Rediger metadata" side="top">
                        <button
                          onClick={() => startEdit(rapport)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-yellow-50 hover:text-yellow-600 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      </Tooltip>
                      <Tooltip content="Koble AI-views" side="top">
                        <button
                          onClick={() => åpneAiKobling(rapport)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-purple-50 hover:text-purple-600 transition-colors"
                        >
                          <Link2 className="w-4 h-4" />
                        </button>
                      </Tooltip>
                      <Tooltip content="Tilgangsstyring" side="top">
                        <button
                          onClick={() => setTilgangRapport({ id: rapport.id, navn: rapport.navn })}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        >
                          <Shield className="w-4 h-4" />
                        </button>
                      </Tooltip>
                      <Tooltip content="Fjern fra workspace" side="top">
                        <button
                          onClick={() => setUnlinkId(rapport.id)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </Tooltip>
                      <Tooltip content="Fjern fra portal" side="top">
                        <button
                          onClick={() => setDeaktiverLId(rapport.id)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-orange-50 hover:text-orange-600 transition-colors"
                        >
                          <EyeOff className="w-4 h-4" />
                        </button>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Portal rapport-velger */}
      <Dialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Legg til rapport fra portalen"
        className="max-w-lg"
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input
              placeholder="Søk etter rapport..."
              className="pl-9"
              value={pickerSøk}
              onChange={(e) => setPickerSøk(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-80 overflow-y-auto space-y-0.5 -mx-1 px-1">
            {alleLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full mb-1" />)
            ) : filtrerteRapporter.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                {alleRapporter.length === 0
                  ? 'Ingen rapporter registrert i portalen.'
                  : 'Ingen treff — alle tilgjengelige rapporter er allerede lagt til.'}
              </p>
            ) : (
              filtrerteRapporter.map((rapport) => (
                <div key={rapport.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50">
                  <FileBarChart className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{rapport.navn}</p>
                    {rapport.beskrivelse && (
                      <p className="text-xs text-gray-400 truncate">{rapport.beskrivelse}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={linkingId === rapport.id}
                    onClick={() => handleLinkRapport(rapport.id)}
                    className="flex-shrink-0"
                  >
                    {linkingId === rapport.id ? 'Legger til...' : 'Legg til'}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </Dialog>

      {/* Metadata-redigering per rapport */}
      <Dialog
        open={!!editRapport}
        onClose={() => setEditRapport(null)}
        title={`Rediger metadata – ${editRapport?.navn ?? ''}`}
        className="max-w-lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Navn</label>
            <Input
              value={editForm.navn}
              onChange={(e) => setEditForm((f) => ({ ...f, navn: e.target.value }))}
              placeholder="Rapportnavn"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Område</label>
            <Input
              value={editForm.område}
              onChange={(e) => setEditForm((f) => ({ ...f, område: e.target.value }))}
              placeholder="f.eks. Produksjon, HMS, Økonomi"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Beskrivelse</label>
            <textarea
              value={editForm.beskrivelse}
              onChange={(e) => setEditForm((f) => ({ ...f, beskrivelse: e.target.value }))}
              placeholder="Kort forklaring av rapporten..."
              rows={3}
              maxLength={500}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nøkkelord</label>
            <Input
              value={editForm.nøkkelord}
              onChange={(e) => setEditForm((f) => ({ ...f, nøkkelord: e.target.value }))}
              placeholder="f.eks. bolting, sprøyting, 6050"
            />
            <p className="text-xs text-gray-400 mt-1">Kommaseparerte søkeord for AI-søk</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditRapport(null)} disabled={saving}>
            Avbryt
          </Button>
          <Button onClick={saveEdit} disabled={saving || !editForm.navn.trim()}>
            {saving ? 'Lagrer...' : 'Lagre'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* PBI-browser: legg til ny rapport direkte fra Power BI */}
      <PBIRapportBrowser
        open={pbiOpen}
        onClose={() => setPbiOpen(false)}
        workspaceId={id}
        onSuccess={fetchData}
      />

      {/* Tilgangsstyring per rapport */}
      {tilgangRapport && (
        <Dialog
          open={!!tilgangRapport}
          onClose={() => setTilgangRapport(null)}
          title={`Tilgang – ${tilgangRapport.navn}`}
          className="max-w-2xl"
        >
          <TilgangStyring
            entityType="rapport"
            entityId={tilgangRapport.id}
            entityNavn={tilgangRapport.navn}
          />
        </Dialog>
      )}

      {/* Fjern kobling-bekreftelse */}
      <Dialog
        open={!!unlinkId}
        onClose={() => setUnlinkId(null)}
        title="Fjern rapport fra workspace"
      >
        <p className="text-sm text-gray-600">
          Vil du fjerne{' '}
          <span className="font-semibold text-gray-900">{toUnlink?.navn}</span>{' '}
          fra dette workspacet?
          <br />
          <span className="text-xs text-gray-400 mt-1 block">
            Rapporten slettes ikke globalt — bare koblingen til dette workspacet fjernes.
          </span>
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setUnlinkId(null)} disabled={unlinking}>
            Avbryt
          </Button>
          <Button variant="destructive" onClick={handleUnlink} disabled={unlinking}>
            {unlinking ? 'Fjerner...' : 'Fjern fra workspace'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* AI-view kobling — glass modal */}
      {aiKoblingRapport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.60)', backdropFilter: 'blur(4px)' }}
          onClick={() => setAiKoblingRapport(null)}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto"
            style={{
              background: 'rgba(15,25,45,0.95)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 14,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 style={{ fontWeight: 700, fontSize: 16, color: 'rgba(255,255,255,0.90)', margin: 0 }}>
                    Koble AI-views
                  </h2>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', marginTop: 3, marginBottom: 0 }}>
                    {aiKoblingRapport.navn}
                  </p>
                </div>
                <button
                  onClick={() => setAiKoblingRapport(null)}
                  style={{ fontSize: 22, lineHeight: 1, color: 'rgba(255,255,255,0.40)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Content */}
            <div style={{ padding: '16px 24px 24px' }}>
              {/* Existing couplings */}
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.40)', marginBottom: 8 }}>
                Aktive koblinger
              </p>
              {aiLoadingKobling ? (
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.40)', marginBottom: 16 }}>Laster…</p>
              ) : kobletViews.length === 0 ? (
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 16 }}>
                  Ingen koblinger. AI bruker område-filter som standard.
                </p>
              ) : (
                <div className="space-y-2" style={{ marginBottom: 16 }}>
                  {kobletViews.map(v => (
                    <div
                      key={v.view_id}
                      className="flex items-center gap-3"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 14px' }}
                    >
                      <div className="flex-1 min-w-0">
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.90)' }}>{v.visningsnavn}</span>
                        {v.område && (
                          <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(245,166,35,0.10)', border: '1px solid rgba(245,166,35,0.20)', color: '#F5A623', display: 'inline-block' }}>
                            {v.område}
                          </span>
                        )}
                        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2, marginBottom: 0 }}>
                          Prioritet: {v.prioritet}
                        </p>
                      </div>
                      <button
                        onClick={() => fjernAiKobling(v.view_id)}
                        style={{ color: 'rgba(255,255,255,0.30)', background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, flexShrink: 0 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(239,68,68,0.80)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.30)'; }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.40)', marginBottom: 10 }}>
                  Legg til view
                </p>
                <div className="flex gap-2">
                  <select
                    value={nyViewId}
                    onChange={e => setNyViewId(e.target.value)}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: nyViewId ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.40)', outline: 'none' }}
                  >
                    <option value="">Velg view...</option>
                    {aiViews.map(v => (
                      <option key={v.id} value={v.id}>{v.visningsnavn}{v.område ? ` (${v.område})` : ''}</option>
                    ))}
                  </select>
                  <select
                    value={nyPrioritet}
                    onChange={e => setNyPrioritet(Number(e.target.value))}
                    style={{ width: 130, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'rgba(255,255,255,0.80)', outline: 'none', flexShrink: 0 }}
                  >
                    <option value={1}>1 — Primær</option>
                    <option value={2}>2 — Sekundær</option>
                    <option value={0}>0 — Standard</option>
                  </select>
                  <button
                    onClick={leggTilAiKobling}
                    disabled={!nyViewId}
                    style={{
                      padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, flexShrink: 0,
                      background: nyViewId ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.04)',
                      border: nyViewId ? '1px solid rgba(245,166,35,0.30)' : '1px solid rgba(255,255,255,0.08)',
                      color: nyViewId ? '#F5A623' : 'rgba(255,255,255,0.30)',
                      cursor: nyViewId ? 'pointer' : 'not-allowed',
                      transition: 'all 0.15s',
                    }}
                  >
                    Koble
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fjern fra portal (soft delete) */}
      <Dialog
        open={!!deaktiverId}
        onClose={() => setDeaktiverLId(null)}
        title="Fjern rapport fra portalen"
      >
        <p className="text-sm text-gray-600">
          Vil du fjerne{' '}
          <span className="font-semibold text-gray-900">{toDeaktiver?.navn}</span>{' '}
          fra portalen?
        </p>
        <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Dette fjerner rapporten fra portalen. Rapporten vil fortsatt finnes i Power BI.
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Historikk og tilgangsstyring bevares — rapporten kan aktiveres igjen ved behov.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeaktiverLId(null)} disabled={deaktiverer}>
            Avbryt
          </Button>
          <Button variant="destructive" onClick={handleDeaktiver} disabled={deaktiverer}>
            {deaktiverer ? 'Fjerner...' : 'Fjern fra portalen'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
