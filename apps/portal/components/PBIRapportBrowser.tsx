'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { FileBarChart, Search, RefreshCw } from 'lucide-react';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/apiClient';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface PbiWorkspace {
  id: string;
  name: string;
}

interface PbiRapport {
  id: string;
  name: string;
  datasetId: string;
  workspaceId: string;
  workspaceName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onSuccess: () => void;
}

export default function PBIRapportBrowser({ open, onClose, workspaceId, onSuccess }: Props) {
  const [alleRapporter, setAlleRapporter] = useState<PbiRapport[]>([]);
  const [loading, setLoading]             = useState(false);
  const [søk, setSøk]                     = useState('');
  const [valgteIds, setValgteIds]         = useState<Set<string>>(new Set());
  const [submitting, setSubmitting]       = useState(false);

  const lastAlleRapporter = useCallback(async () => {
    setLoading(true);
    setAlleRapporter([]);
    setValgteIds(new Set());
    try {
      const wsRes = await apiFetch('/api/pbi/workspaces');
      if (!wsRes.ok) throw new Error(`HTTP ${wsRes.status}`);
      const workspaces = await wsRes.json() as PbiWorkspace[];

      const flat: PbiRapport[] = [];
      await Promise.all(
        workspaces.map(async (ws) => {
          try {
            const rapRes = await apiFetch(`/api/pbi/workspaces/${ws.id}/rapporter`);
            if (!rapRes.ok) return;
            const rapporter = await rapRes.json() as Array<{ id: string; name: string; datasetId: string }>;
            for (const r of rapporter) {
              flat.push({
                id:            r.id,
                name:          r.name,
                datasetId:     r.datasetId,
                workspaceId:   ws.id,
                workspaceName: ws.name,
              });
            }
          } catch {
            // hopp over workspace hvis den feiler
          }
        }),
      );

      flat.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
      setAlleRapporter(flat);
    } catch {
      toast({ title: 'Kunne ikke hente PBI-rapporter', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSøk('');
    setValgteIds(new Set());
    lastAlleRapporter();
  }, [open, lastAlleRapporter]);

  const filtrerte = useMemo(() => {
    const q = søk.toLowerCase();
    return alleRapporter.filter(
      (r) => r.name.toLowerCase().includes(q) || r.workspaceName.toLowerCase().includes(q),
    );
  }, [alleRapporter, søk]);

  const toggleValgt = (id: string) => {
    setValgteIds((prev) => {
      const neste = new Set(prev);
      if (neste.has(id)) neste.delete(id); else neste.add(id);
      return neste;
    });
  };

  const handleLeggTil = async () => {
    if (valgteIds.size === 0 || submitting) return;
    setSubmitting(true);

    const valgte = alleRapporter.filter((r) => valgteIds.has(r.id));
    let ok = 0;
    let feil = 0;

    await Promise.all(
      valgte.map(async (rapport) => {
        try {
          const createRes = await apiFetch('/api/rapporter', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              navn:           rapport.name,
              pbiReportId:    rapport.id,
              pbiDatasetId:   rapport.datasetId,
              pbiWorkspaceId: rapport.workspaceId,
            }),
          });
          if (!createRes.ok) {
            const data = await createRes.json() as { error?: string };
            throw new Error(data.error ?? `HTTP ${createRes.status}`);
          }
          const ny = await createRes.json() as { id: string };

          const linkRes = await apiFetch(`/api/workspaces/${workspaceId}/rapporter`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ rapportId: ny.id }),
          });
          if (!linkRes.ok) throw new Error(`Kobling feilet: HTTP ${linkRes.status}`);
          ok++;
        } catch {
          feil++;
        }
      }),
    );

    setSubmitting(false);

    if (ok > 0) {
      toast({ title: `${ok} rapport${ok !== 1 ? 'er' : ''} lagt til`, variant: 'success' });
      onSuccess();
    }
    if (feil > 0) {
      toast({ title: `${feil} rapport${feil !== 1 ? 'er' : ''} feilet`, variant: 'destructive' });
    }
    if (ok > 0) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Legg til fra Power BI" className="max-w-lg">
      <div className="space-y-3">
        {/* Søk + oppdater */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <Input
              placeholder="Søk etter rapport eller workspace..."
              className="pl-9"
              value={søk}
              onChange={(e) => setSøk(e.target.value)}
              autoFocus
            />
          </div>
          <button
            onClick={lastAlleRapporter}
            disabled={loading}
            title="Hent fersk liste fra Power BI"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-400 hover:text-brand-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Flat liste med checkboxer */}
        <div className="max-h-80 overflow-y-auto space-y-0.5 -mx-1 px-1">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full mb-1" />
            ))
          ) : filtrerte.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">
              {alleRapporter.length === 0
                ? 'Ingen rapporter funnet i Power BI.'
                : 'Ingen treff på søket.'}
            </p>
          ) : (
            filtrerte.map((rapport) => {
              const valgt = valgteIds.has(rapport.id);
              return (
                <div
                  key={rapport.id}
                  onClick={() => toggleValgt(rapport.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors select-none ${
                    valgt ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={valgt}
                    onChange={() => toggleValgt(rapport.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 cursor-pointer flex-shrink-0 accent-blue-600"
                  />
                  <FileBarChart className={`w-4 h-4 flex-shrink-0 ${valgt ? 'text-blue-500' : 'text-gray-400'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{rapport.name}</p>
                    <p className="text-xs text-gray-400 truncate">{rapport.workspaceName}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <DialogFooter>
        <span className="text-sm text-gray-400 mr-auto">
          {valgteIds.size > 0 ? `${valgteIds.size} valgt` : 'Ingen valgt'}
        </span>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Avbryt
        </Button>
        <Button
          onClick={handleLeggTil}
          disabled={valgteIds.size === 0 || submitting}
        >
          {submitting
            ? 'Legger til...'
            : valgteIds.size > 0
              ? `Legg til (${valgteIds.size})`
              : 'Legg til'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
