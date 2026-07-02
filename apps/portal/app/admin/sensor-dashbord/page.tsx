'use client';

/**
 * Admin-oversikt over sensor-dashbord. Aggregerer dashbord på tvers av
 * workspacene admin har tilgang til, med workspace-filter.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Trash2, ExternalLink } from '@/components/ikoner';
import { apiFetch } from '@/lib/apiClient';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

interface Workspace { id: string; navn: string }
interface DashbordRad {
  id: string; navn: string; tidsvinduMinutter: number; oppdateringsIntervallSek: number;
  konfig: string; opprettet: string; oppdatert: string; workspaceId: string; workspaceNavn: string;
}

const datoFmt = new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', day: '2-digit', month: '2-digit', year: '2-digit' });
const antallGrafer = (konfig: string): number => { try { return JSON.parse(konfig).grafer?.length ?? 0; } catch { return 0; } };

export default function SensorDashbordListe() {
  const { authHeaders } = usePortalAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [rader, setRader] = useState<DashbordRad[]>([]);
  const [filter, setFilter] = useState('');
  const [laster, setLaster] = useState(true);
  const [sletter, setSletter] = useState<string | null>(null);

  useEffect(() => {
    if (Object.keys(authHeaders).length === 0) return;
    let avbrutt = false;
    (async () => {
      setLaster(true);
      try {
        const wsRes = await apiFetch('/api/workspaces', { headers: authHeaders });
        const ws: Workspace[] = wsRes.ok ? await wsRes.json() : [];
        if (avbrutt) return;
        setWorkspaces(ws.map(w => ({ id: w.id, navn: w.navn })));
        const grupper = await Promise.all(ws.map(async w => {
          const r = await apiFetch(`/api/sensor-dashbord?workspaceId=${w.id}`, { headers: authHeaders });
          const d: DashbordRad[] = r.ok ? await r.json() : [];
          return d.map(x => ({ ...x, workspaceId: w.id, workspaceNavn: w.navn }));
        }));
        if (!avbrutt) setRader(grupper.flat());
      } catch { /* ignore */ }
      finally { if (!avbrutt) setLaster(false); }
    })();
    return () => { avbrutt = true; };
  }, [authHeaders]);

  const slett = async (rad: DashbordRad) => {
    if (!window.confirm(`Slette dashbordet "${rad.navn}"?`)) return;
    setSletter(rad.id);
    try {
      const res = await apiFetch(`/api/admin/sensor-dashbord/${rad.id}`, { method: 'DELETE', headers: authHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: 'Dashbord slettet', variant: 'success' });
      setRader(r => r.filter(x => x.id !== rad.id));
    } catch (e) {
      toast({ title: 'Kunne ikke slette', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally { setSletter(null); }
  };

  const synlige = filter ? rader.filter(r => r.workspaceId === filter) : rader;
  const celle: React.CSSProperties = { padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 13, borderBottom: '1px solid var(--glass-bg)' };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontFamily: 'var(--font-segoe)', fontWeight: 600, fontSize: 18, color: 'var(--text-primary)' }}>
          Sensor-dashbord
        </h1>
        <Link href="/admin/sensor-dashbord/ny"><Button size="sm"><Plus className="w-4 h-4 mr-1" /> Nytt dashbord</Button></Link>
      </div>

      <div className="mb-4">
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="px-3 py-2 rounded-md border text-sm" style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-bg-hover)', color: 'var(--text-primary)' }}>
          <option value="">Alle workspaces</option>
          {workspaces.map(w => <option key={w.id} value={w.id}>{w.navn}</option>)}
        </select>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(17,29,51,0.55)', border: '1px solid var(--glass-bg-hover)' }}>
        <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Navn', 'Workspace', 'Grafer', 'Tidsvindu', 'Intervall', 'Sist endret', ''].map((h, i) => (
                <th key={i} style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--glass-bg-hover)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {laster ? (
              <tr><td colSpan={7} style={{ ...celle, textAlign: 'center', color: 'var(--text-muted)' }}>Laster …</td></tr>
            ) : synlige.length === 0 ? (
              <tr><td colSpan={7} style={{ ...celle, textAlign: 'center', color: 'var(--text-muted)' }}>Ingen dashbord ennå.</td></tr>
            ) : synlige.map(r => (
              <tr key={r.id}>
                <td style={{ ...celle, color: 'var(--text-primary)', fontWeight: 600 }}>{r.navn}</td>
                <td style={celle}>{r.workspaceNavn}</td>
                <td style={celle}>{antallGrafer(r.konfig)}</td>
                <td style={celle}>{r.tidsvinduMinutter} min</td>
                <td style={celle}>{r.oppdateringsIntervallSek} s</td>
                <td style={celle}>{datoFmt.format(new Date(r.oppdatert))}</td>
                <td style={{ ...celle, whiteSpace: 'nowrap' }}>
                  <div className="flex items-center gap-2 justify-end">
                    <Link href={`/admin/sensor-dashbord/${r.id}`} title="Rediger" style={{ color: 'var(--text-secondary)' }}><Pencil className="w-4 h-4" /></Link>
                    <a href={`/dashboard/sensorer/${r.id}`} target="_blank" rel="noopener noreferrer" title="Preview" style={{ color: 'var(--text-secondary)' }}><ExternalLink className="w-4 h-4" /></a>
                    <button type="button" onClick={() => slett(r)} disabled={sletter === r.id} title="Slett" style={{ color: 'rgba(252,165,165,0.95)' }}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
