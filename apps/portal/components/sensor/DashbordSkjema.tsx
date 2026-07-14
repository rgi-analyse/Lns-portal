'use client';

/**
 * Delt skjema for opprett (POST) og rediger (PUT) av sensor-dashbord.
 * Workspace er immutable ved redigering. Sensor-dropdown filtreres per workspace.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Loader2, ExternalLink } from '@/components/ikoner';
import { apiFetch } from '@/lib/apiClient';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';
import { FARGER, FARGE_HEX, FARGE_NAVN, type Farge } from './farger';

interface Workspace { id: string; navn: string }
interface Sensor { id: string; navn: string; enhet?: string | null }
interface Graf { sensorId: string; tittel: string; yMin: string; yMax: string; farge: Farge; medianVinduSek: string }

const MEDIAN_VINDU_DEFAULT = '300';
const TOM_GRAF: Graf = { sensorId: '', tittel: '', yMin: '', yMax: '', farge: 'primary', medianVinduSek: MEDIAN_VINDU_DEFAULT };

const selectStil: React.CSSProperties = { background: 'var(--glass-bg)', borderColor: 'var(--glass-bg-hover)', color: 'var(--text-primary)' };

export default function DashbordSkjema({ dashbordId }: { dashbordId?: string }) {
  const router = useRouter();
  const { authHeaders, grupper } = usePortalAuth();
  const erNy = !dashbordId;
  const gq = grupper.length ? `?grupper=${encodeURIComponent(grupper.join(','))}` : '';

  const [navn, setNavn] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [tidsvindu, setTidsvindu] = useState('30');
  const [intervall, setIntervall] = useState('10');
  const [layout, setLayout] = useState<'vertikal' | 'rutenett-2'>('vertikal');
  const [grafer, setGrafer] = useState<Graf[]>([{ ...TOM_GRAF }]);
  const [visSensorNavn, setVisSensorNavn] = useState(true);
  const [visSisteVerdi, setVisSisteVerdi] = useState(true);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sensorer, setSensorer] = useState<Sensor[]>([]);
  const [laster, setLaster] = useState(!erNy);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  // Workspaces (for dropdown).
  useEffect(() => {
    apiFetch('/api/workspaces', { headers: authHeaders })
      .then(r => (r.ok ? (r.json() as Promise<Workspace[]>) : []))
      .then(ws => setWorkspaces(ws.map(w => ({ id: w.id, navn: w.navn }))))
      .catch(() => {});
  }, [authHeaders]);

  // Eksisterende dashbord (rediger).
  useEffect(() => {
    if (erNy || !dashbordId) return;
    setLaster(true);
    apiFetch(`/api/sensor-dashbord/${dashbordId}${gq}`, { headers: authHeaders })
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? `HTTP ${r.status}`); return r.json(); })
      .then((d: { navn: string; workspaceId: string; tidsvinduMinutter: number; oppdateringsIntervallSek: number; konfig: { layout?: string; grafer?: { sensorId: string; tittel: string; yMin?: number | null; yMax?: number | null; farge: Farge; medianVinduSek?: number }[]; visSensorNavn?: boolean; visSisteVerdi?: boolean } | null }) => {
        setNavn(d.navn);
        setWorkspaceId(d.workspaceId);
        setTidsvindu(String(d.tidsvinduMinutter));
        setIntervall(String(d.oppdateringsIntervallSek));
        const k = d.konfig ?? {};
        setLayout(k.layout === 'rutenett-2' ? 'rutenett-2' : 'vertikal');   // backwards compat
        setVisSensorNavn(k.visSensorNavn ?? true);
        setVisSisteVerdi(k.visSisteVerdi ?? true);
        const g = (k.grafer ?? []).map(x => ({ sensorId: x.sensorId, tittel: x.tittel, yMin: x.yMin == null ? '' : String(x.yMin), yMax: x.yMax == null ? '' : String(x.yMax), farge: x.farge, medianVinduSek: x.medianVinduSek == null ? MEDIAN_VINDU_DEFAULT : String(x.medianVinduSek) }));
        setGrafer(g.length > 0 ? g : [{ ...TOM_GRAF }]);
      })
      .catch(e => setFeil(e instanceof Error ? e.message : 'Kunne ikke laste dashbord.'))
      .finally(() => setLaster(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashbordId]);

  // Sensorer for valgt workspace.
  useEffect(() => {
    if (!workspaceId) { setSensorer([]); return; }
    const p = new URLSearchParams({ workspaceId });
    if (grupper.length) p.set('grupper', grupper.join(','));
    apiFetch(`/api/sensor?${p.toString()}`, { headers: authHeaders })
      .then(r => (r.ok ? (r.json() as Promise<Sensor[]>) : []))
      .then(setSensorer)
      .catch(() => setSensorer([]));
  }, [workspaceId, authHeaders, grupper]);

  const oppdaterGraf = (i: number, delta: Partial<Graf>) => setGrafer(g => g.map((x, idx) => (idx === i ? { ...x, ...delta } : x)));
  const leggTilGraf = () => setGrafer(g => (g.length < 6 ? [...g, { ...TOM_GRAF }] : g));
  const fjernGraf = (i: number) => setGrafer(g => (g.length > 1 ? g.filter((_, idx) => idx !== i) : g));

  const lagre = async () => {
    setFeil(null);
    if (!navn.trim()) { setFeil('Navn er påkrevd.'); return; }
    if (!workspaceId) { setFeil('Velg workspace.'); return; }
    if (grafer.some(g => !g.sensorId || !g.tittel.trim())) { setFeil('Hver graf trenger sensor og tittel.'); return; }
    // Median-vindu: tom → default 300; ellers heltall 1–1800 (speiler server-zod).
    if (grafer.some(g => {
      if (g.medianVinduSek.trim() === '') return false;
      const n = Number(g.medianVinduSek);
      return !Number.isInteger(n) || n < 1 || n > 1800;
    })) { setFeil('Median-vindu må være et heltall 1–1800 sek.'); return; }

    const konfig = {
      layout,
      grafer: grafer.map(g => ({
        sensorId: g.sensorId,
        tittel: g.tittel.trim(),
        yMin: g.yMin.trim() === '' ? null : Number(g.yMin),
        yMax: g.yMax.trim() === '' ? null : Number(g.yMax),
        farge: g.farge,
        medianVinduSek: g.medianVinduSek.trim() === '' ? 300 : Number(g.medianVinduSek),
      })),
      visSensorNavn,
      visSisteVerdi,
    };
    const body = { navn: navn.trim(), workspaceId, tidsvinduMinutter: Number(tidsvindu), oppdateringsIntervallSek: Number(intervall), konfig };

    setLagrer(true);
    try {
      const url = erNy ? '/api/admin/sensor-dashbord' : `/api/admin/sensor-dashbord/${dashbordId}`;
      const res = await apiFetch(url, { method: erNy ? 'POST' : 'PUT', headers: { ...authHeaders, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const k = await res.json().catch(() => ({})) as { error?: string; detaljer?: string[] };
        throw new Error([k.error, ...(k.detaljer ?? [])].filter(Boolean).join(' — ') || `HTTP ${res.status}`);
      }
      toast({ title: erNy ? 'Dashbord opprettet' : 'Dashbord lagret', variant: 'success' });
      router.push('/admin/sensor-dashbord');
    } catch (e) {
      setFeil(e instanceof Error ? e.message : 'Ukjent feil');
    } finally {
      setLagrer(false);
    }
  };

  if (laster) return <div className="p-8" style={{ color: 'var(--text-muted)' }}>Laster …</div>;

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/admin/sensor-dashbord" className="inline-flex items-center gap-1.5 text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft className="w-4 h-4" /> Tilbake til oversikt
      </Link>
      <h1 className="mb-6" style={{ fontFamily: 'var(--font-segoe)', fontWeight: 600, fontSize: 18, color: 'var(--text-primary)' }}>
        {erNy ? 'Nytt sensor-dashbord' : 'Rediger sensor-dashbord'}
      </h1>

      <div className="rounded-xl p-6 space-y-5" style={{ background: 'rgba(17,29,51,0.65)', backdropFilter: 'blur(20px)', border: '1px solid var(--glass-bg-hover)' }}>
        <div>
          <Label style={{ color: 'var(--text-primary)' }}>Navn <span className="text-red-500">*</span></Label>
          <Input value={navn} onChange={e => setNavn(e.target.value)} placeholder='F.eks. "Skaland kontrollrom"' />
        </div>

        <div>
          <Label style={{ color: 'var(--text-primary)' }}>Workspace <span className="text-red-500">*</span></Label>
          <select value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} disabled={!erNy}
            className="w-full mt-1 px-3 py-2 rounded-md border text-sm disabled:opacity-60" style={selectStil}>
            <option value="">Velg workspace…</option>
            {workspaces.map(w => <option key={w.id} value={w.id}>{w.navn}</option>)}
          </select>
          {!erNy && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Workspace kan ikke endres for eksisterende dashbord.</p>}
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <Label style={{ color: 'var(--text-primary)' }}>Tidsvindu (min) <span className="text-red-500">*</span></Label>
            <Input type="number" min={1} max={1440} value={tidsvindu} onChange={e => setTidsvindu(e.target.value)} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>1–1440. Standard 30.</p>
          </div>
          <div className="flex-1">
            <Label style={{ color: 'var(--text-primary)' }}>Intervall (sek) <span className="text-red-500">*</span></Label>
            <Input type="number" min={2} max={60} value={intervall} onChange={e => setIntervall(e.target.value)} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>2–60. 2–5 = sanntid, 10 = standard, 30–60 = trend.</p>
          </div>
          <div className="flex-1">
            <Label style={{ color: 'var(--text-primary)' }}>Layout</Label>
            <select value={layout} onChange={e => setLayout(e.target.value as 'vertikal' | 'rutenett-2')}
              className="w-full mt-1 px-3 py-2 rounded-md border text-sm" style={selectStil}>
              <option value="vertikal">Vertikal (stack)</option>
              <option value="rutenett-2">Rutenett 2 kolonner</option>
            </select>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Rutenett → vertikal under 1200px.</p>
          </div>
        </div>

        {/* Grafer */}
        <div>
          <Label style={{ color: 'var(--text-primary)' }}>Grafer <span className="text-red-500">*</span> ({grafer.length}/6)</Label>
          {!workspaceId && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Velg workspace først for å se sensorer.</p>}
          <div className="space-y-3 mt-2">
            {grafer.map((g, i) => (
              <div key={i} className="rounded-lg p-3 space-y-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-bg-hover)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Graf {i + 1}</span>
                  {grafer.length > 1 && (
                    <button type="button" onClick={() => fjernGraf(i)} className="inline-flex items-center gap-1 text-xs" style={{ color: 'rgba(252,165,165,0.95)' }}>
                      <Trash2 className="w-3.5 h-3.5" /> Fjern
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <select value={g.sensorId} onChange={e => oppdaterGraf(i, { sensorId: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-md border text-sm" style={selectStil}>
                    <option value="">Velg sensor…</option>
                    {g.sensorId && !sensorer.some(s => s.id === g.sensorId) && <option value={g.sensorId}>(sensor ikke i workspace)</option>}
                    {sensorer.map(s => <option key={s.id} value={s.id}>{s.navn}{s.enhet ? ` (${s.enhet})` : ''}</option>)}
                  </select>
                  <select value={g.farge} onChange={e => oppdaterGraf(i, { farge: e.target.value as Farge })}
                    className="px-3 py-2 rounded-md border text-sm" style={{ ...selectStil, minWidth: 150 }}>
                    {FARGER.map(f => <option key={f} value={f}>{FARGE_NAVN[f]}</option>)}
                  </select>
                  <span title={g.farge} className="w-8 h-8 rounded shrink-0 self-center" style={{ background: FARGE_HEX[g.farge], border: '1px solid var(--glass-bg-hover)' }} />
                </div>
                <Input placeholder="Tittel (visningsnavn)" value={g.tittel} onChange={e => oppdaterGraf(i, { tittel: e.target.value })} />
                <div className="flex gap-2">
                  <Input type="number" placeholder="y-min (valgfri)" value={g.yMin} onChange={e => oppdaterGraf(i, { yMin: e.target.value })} />
                  <Input type="number" placeholder="y-max (valgfri)" value={g.yMax} onChange={e => oppdaterGraf(i, { yMax: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs" style={{ color: 'var(--text-muted)' }}>Median-vindu (sek)</Label>
                  <Input type="number" min={1} max={1800} step={1} placeholder="300" value={g.medianVinduSek} onChange={e => oppdaterGraf(i, { medianVinduSek: e.target.value })} />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>1–1800 sek (300 = 5 min). Tom = 300.</p>
                </div>
              </div>
            ))}
          </div>
          {grafer.length < 6 && (
            <Button type="button" variant="outline" size="sm" onClick={leggTilGraf} className="mt-3">
              <Plus className="w-4 h-4 mr-1" /> Legg til graf
            </Button>
          )}
        </div>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={visSensorNavn} onChange={e => setVisSensorNavn(e.target.checked)} style={{ accentColor: 'var(--gold)' }} /> Vis sensor-navn
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={visSisteVerdi} onChange={e => setVisSisteVerdi(e.target.checked)} style={{ accentColor: 'var(--gold)' }} /> Vis siste verdi
          </label>
        </div>

        {feil && <p className="text-sm" style={{ color: 'rgba(252,165,165,0.95)' }}>{feil}</p>}

        <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--glass-bg-hover)' }}>
          <Link href="/admin/sensor-dashbord"><Button type="button" variant="outline" size="sm">Avbryt</Button></Link>
          <div className="flex gap-2">
            {!erNy && (
              <a href={`/dashboard/sensorer/${dashbordId}`} target="_blank" rel="noopener noreferrer">
                <Button type="button" variant="outline" size="sm"><ExternalLink className="w-4 h-4 mr-1" /> Preview</Button>
              </a>
            )}
            <Button type="button" size="sm" disabled={lagrer} onClick={lagre}>
              {lagrer ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Lagrer…</> : 'Lagre'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
