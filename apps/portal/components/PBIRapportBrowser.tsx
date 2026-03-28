'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, Database, FileBarChart, Search, RefreshCw } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface PbiWorkspace {
  id: string;
  name: string;
  type: string;
  capacityId?: string;
}

interface PbiRapport {
  id: string;
  name: string;
  datasetId: string;
  webUrl: string;
  embedUrl: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onSuccess: () => void;
}

type Step = 'workspaces' | 'rapporter' | 'legg-til';

export default function PBIRapportBrowser({ open, onClose, workspaceId, onSuccess }: Props) {
  const [step, setStep]               = useState<Step>('workspaces');
  const [workspaces, setWorkspaces]   = useState<PbiWorkspace[]>([]);
  const [wsLoading, setWsLoading]     = useState(false);
  const [wsSearch, setWsSearch]       = useState('');
  const [selectedWs, setSelectedWs]   = useState<PbiWorkspace | null>(null);

  const [rapporter, setRapporter]           = useState<PbiRapport[]>([]);
  const [rLoading, setRLoading]             = useState(false);
  const [rSearch, setRSearch]               = useState('');
  const [selectedRapport, setSelectedRapport] = useState<PbiRapport | null>(null);

  const [navn, setNavn]               = useState('');
  const [beskrivelse, setBeskrivelse] = useState('');
  const [submitting, setSubmitting]   = useState(false);

  // Last workspaces når modalen åpner
  useEffect(() => {
    if (!open) return;
    setStep('workspaces');
    setWsSearch('');
    setRSearch('');
    setSelectedWs(null);
    setSelectedRapport(null);
    setWorkspaces([]);
    setWsLoading(true);
    fetch(`${API}/api/pbi/workspaces`)
      .then((r) => r.json() as Promise<PbiWorkspace[]>)
      .then(setWorkspaces)
      .catch(() => toast({ title: 'Kunne ikke hente PBI workspaces', variant: 'destructive' }))
      .finally(() => setWsLoading(false));
  }, [open]);

  const filteredWs = useMemo(
    () => workspaces.filter((w) => w.name.toLowerCase().includes(wsSearch.toLowerCase())),
    [workspaces, wsSearch],
  );

  const filteredRapporter = useMemo(
    () => rapporter.filter((r) => r.name.toLowerCase().includes(rSearch.toLowerCase())),
    [rapporter, rSearch],
  );

  const hentRapporter = useCallback((ws: PbiWorkspace) => {
    setRapporter([]);
    setRLoading(true);
    fetch(`${API}/api/pbi/workspaces/${ws.id}/rapporter`)
      .then((r) => r.json() as Promise<PbiRapport[]>)
      .then(setRapporter)
      .catch(() => toast({ title: 'Kunne ikke hente rapporter', variant: 'destructive' }))
      .finally(() => setRLoading(false));
  }, []);

  const handleSelectWs = (ws: PbiWorkspace) => {
    setSelectedWs(ws);
    setStep('rapporter');
    setRSearch('');
    hentRapporter(ws);
  };

  const handleSelectRapport = (rapport: PbiRapport) => {
    setSelectedRapport(rapport);
    setNavn(rapport.name);
    setBeskrivelse('');
    setStep('legg-til');
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRapport || !selectedWs || !navn.trim()) return;
    setSubmitting(true);
    try {
      // Steg 1: Opprett rapport globalt
      const createRes = await fetch(`${API}/api/rapporter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          navn:           navn.trim(),
          beskrivelse:    beskrivelse.trim() || undefined,
          pbiReportId:    selectedRapport.id,
          pbiDatasetId:   selectedRapport.datasetId,
          pbiWorkspaceId: selectedWs.id,
        }),
      });
      if (!createRes.ok) {
        const data = await createRes.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${createRes.status}`);
      }
      const nyRapport = await createRes.json() as { id: string };

      // Steg 2: Koble til dette workspacet
      const linkRes = await fetch(`${API}/api/workspaces/${workspaceId}/rapporter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rapportId: nyRapport.id }),
      });
      if (!linkRes.ok) {
        const data = await linkRes.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${linkRes.status}`);
      }

      toast({ title: 'Rapport lagt til og koblet til workspace', variant: 'success' });
      onSuccess();
      onClose();
    } catch (err) {
      toast({
        title: 'Kunne ikke legge til rapport',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const dialogTitle =
    step === 'workspaces' ? 'Velg PBI Workspace'
    : step === 'rapporter' ? `Rapporter – ${selectedWs?.name}`
    : `Legg til rapport`;

  return (
    <Dialog open={open} onClose={onClose} title={dialogTitle} className="max-w-lg">

      {/* ── Steg 1: workspace-liste ─────────────────────────────────────────── */}
      {step === 'workspaces' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input
              placeholder="Søk etter workspace..."
              className="pl-9"
              value={wsSearch}
              onChange={(e) => setWsSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-80 overflow-y-auto space-y-0.5 -mx-1 px-1">
            {wsLoading ? (
              Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full mb-1" />)
            ) : filteredWs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">Ingen workspaces funnet.</p>
            ) : (
              filteredWs.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => handleSelectWs(ws)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-gray-50 transition-colors group"
                >
                  <Database className="w-4 h-4 text-gray-400 group-hover:text-blue-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{ws.name}</p>
                    <p className="text-xs text-gray-400">{ws.type}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Steg 2: rapport-liste ───────────────────────────────────────────── */}
      {step === 'rapporter' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep('workspaces')}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
            >
              <ArrowLeft className="w-4 h-4" /> Tilbake til workspaces
            </button>
            <button
              onClick={() => selectedWs && hentRapporter(selectedWs)}
              disabled={rLoading}
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-600 disabled:opacity-40 transition-colors"
              title="Hent fersk liste fra Power BI"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${rLoading ? 'animate-spin' : ''}`} />
              Oppdater liste
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input
              placeholder="Søk etter rapport..."
              className="pl-9"
              value={rSearch}
              onChange={(e) => setRSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-0.5 -mx-1 px-1">
            {rLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full mb-1" />)
            ) : filteredRapporter.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">Ingen rapporter funnet.</p>
            ) : (
              filteredRapporter.map((rapport) => (
                <div
                  key={rapport.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50"
                >
                  <FileBarChart className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{rapport.name}</p>
                    <p className="text-xs text-gray-400 truncate">{selectedWs?.name}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSelectRapport(rapport)}
                    className="flex-shrink-0"
                  >
                    Legg til
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Steg 3: bekreft navn / beskrivelse ──────────────────────────────── */}
      {step === 'legg-til' && (
        <form onSubmit={handleAdd} noValidate className="space-y-4">
          <button
            type="button"
            onClick={() => setStep('rapporter')}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
          >
            <ArrowLeft className="w-4 h-4" /> Tilbake til rapporter
          </button>

          <div>
            <Label htmlFor="pbi-navn">Navn <span className="text-red-500">*</span></Label>
            <Input
              id="pbi-navn"
              value={navn}
              onChange={(e) => setNavn(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="pbi-beskrivelse">Beskrivelse</Label>
            <Textarea
              id="pbi-beskrivelse"
              value={beskrivelse}
              onChange={(e) => setBeskrivelse(e.target.value)}
              placeholder="Valgfri beskrivelse..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep('rapporter')}
              disabled={submitting}
            >
              Avbryt
            </Button>
            <Button type="submit" disabled={submitting || !navn.trim()}>
              {submitting ? 'Legger til...' : 'Legg til rapport'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
