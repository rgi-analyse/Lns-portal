'use client';

/**
 * Sensor-kontrollrom (Steg 4a — minimal hent + tegn).
 * Fullskjerm-overlay (dekker sidebar/topbar via fixed inset-0), henter siste
 * 30 min (ingen siden-param) og tegner én statisk uPlot-linje. Polling/tema/
 * tidssone kommer i Steg 4b.
 */
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import type uPlot from 'uplot';

const SensorGraf = dynamic(() => import('@/components/sensor/SensorGraf'), { ssr: false });

interface Punkt { ts: string; value: number | null }
interface SensorMeta { id: string; navn: string; enhet?: string | null }

export default function SensorKontrollrom() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const { authHeaders, grupper, authAvklart, isAuthenticated } = usePortalAuth();

  const [meta, setMeta] = useState<SensorMeta | null>(null);
  const [data, setData] = useState<uPlot.AlignedData | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [laster, setLaster] = useState(true);

  useEffect(() => {
    if (!authAvklart) return;
    if (!isAuthenticated || !id) { setLaster(false); return; }

    let avbrutt = false;
    (async () => {
      setLaster(true); setFeil(null);
      try {
        const gq = grupper.length ? `?grupper=${encodeURIComponent(grupper.join(','))}` : '';
        const [listeRes, dataRes] = await Promise.all([
          apiFetch(`/api/sensor${gq}`, { headers: authHeaders }),
          apiFetch(`/api/sensor/${id}/data${gq}`, { headers: authHeaders }),
        ]);
        if (!dataRes.ok) {
          const kropp = await dataRes.json().catch(() => ({})) as { error?: string };
          throw new Error(kropp.error ?? `HTTP ${dataRes.status}`);
        }
        const liste = listeRes.ok ? (await listeRes.json() as SensorMeta[]) : [];
        const { punkter } = await dataRes.json() as { punkter: Punkt[] };
        if (avbrutt) return;
        setMeta(liste.find(s => s.id.toLowerCase() === id.toLowerCase()) ?? null);
        setData([
          punkter.map(p => Date.parse(p.ts) / 1000),
          punkter.map(p => p.value),
        ]);
      } catch (e) {
        if (!avbrutt) setFeil(e instanceof Error ? e.message : 'Ukjent feil');
      } finally {
        if (!avbrutt) setLaster(false);
      }
    })();
    return () => { avbrutt = true; };
  }, [id, authAvklart, isAuthenticated, authHeaders, grupper]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--background)', display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
      <h1 style={{ margin: 0, color: 'var(--text-secondary, #cbd5e1)', fontSize: 18, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {meta?.navn ?? 'Sensor'} — siste 30 min{meta?.enhet ? ` (${meta.enhet})` : ''}
      </h1>

      {authAvklart && !isAuthenticated && <p style={{ color: '#cbd5e1' }}>Du må være innlogget.</p>}
      {laster && <p style={{ color: '#cbd5e1' }}>Laster sensor-data …</p>}
      {feil && <p style={{ color: '#f87171' }}>Kunne ikke hente sensor-data: {feil}</p>}

      {data && !feil && (
        <div style={{ flex: 1, minHeight: 0, background: '#fff', borderRadius: 8, padding: 12 }}>
          <SensorGraf data={data} navn={meta?.navn ?? 'Verdi'} enhet={meta?.enhet ?? undefined} />
        </div>
      )}
    </div>
  );
}
