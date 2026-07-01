'use client';

/**
 * Sensor-kontrollrom (Steg 4b — live).
 * Fullskjerm: dashboard-layouten hopper over sidebar/topbar/chat for
 * /dashboard/sensorer/*-ruter, så en enkel fixed inset-0-container dekker
 * viewporten. Live-polling, tema (gull på navy), Europe/Oslo-tid.
 *
 * tidsvindu/intervall er hardkodet nå — hentes fra SensorDashbord-konfig i
 * Steg 5. Intervallet klampes 2–60 s i useSensorPolling.
 */
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { useSensorPolling } from '@/hooks/useSensorPolling';

const SensorGraf = dynamic(() => import('@/components/sensor/SensorGraf'), { ssr: false });

const TIDSVINDU_MIN = 30;   // TODO Steg 5: fra SensorDashbord.tidsvinduMinutter
const INTERVALL_SEK = 10;   // TODO Steg 5: fra SensorDashbord.oppdateringsIntervallSek

interface SensorMeta { id: string; navn: string; enhet?: string | null }

const datoFmt = new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', day: '2-digit', month: '2-digit', year: '2-digit' });

export default function SensorKontrollrom() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const { authHeaders, grupper, authAvklart, isAuthenticated } = usePortalAuth();

  const [meta, setMeta] = useState<SensorMeta | null>(null);
  const aktiv = authAvklart && isAuthenticated && !!id;

  // Sensor-meta (navn/enhet) — engangs.
  useEffect(() => {
    if (!aktiv) return;
    let avbrutt = false;
    const gq = grupper.length ? `?grupper=${encodeURIComponent(grupper.join(','))}` : '';
    apiFetch(`/api/sensor${gq}`, { headers: authHeaders })
      .then(r => (r.ok ? (r.json() as Promise<SensorMeta[]>) : []))
      .then(liste => { if (!avbrutt) setMeta(liste.find(s => s.id.toLowerCase() === id.toLowerCase()) ?? null); })
      .catch(() => {});
    return () => { avbrutt = true; };
  }, [aktiv, id, authHeaders, grupper]);

  const { data, feil, laster } = useSensorPolling({
    sensorId: id, intervallSek: INTERVALL_SEK, tidsvinduMin: TIDSVINDU_MIN, authHeaders, grupper, aktiv,
  });

  const tomtVindu = !!data && data[0].length === 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--navy-darkest, #0a1628)', display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
        <h1 style={{ margin: 0, color: 'var(--gold, #ffbb00)', fontSize: 18, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {meta?.navn ?? 'Sensor'}{meta?.enhet ? ` (${meta.enhet})` : ''}
        </h1>
        <span style={{ color: 'var(--text-secondary, rgba(255,255,255,0.7))', fontSize: 13 }}>
          {datoFmt.format(new Date())} · siste {TIDSVINDU_MIN} min · oppdaterer hvert {INTERVALL_SEK}s · Europe/Oslo
        </span>
      </div>

      {authAvklart && !isAuthenticated && <p style={{ color: 'rgba(255,255,255,0.7)' }}>Du må være innlogget.</p>}
      {laster && !data && <p style={{ color: 'rgba(255,255,255,0.7)' }}>Laster sensor-data …</p>}
      {feil && <p style={{ color: '#f87171' }}>Kunne ikke hente sensor-data: {feil}</p>}
      {tomtVindu && !feil && <p style={{ color: 'rgba(255,255,255,0.7)' }}>Ingen data i tidsvinduet ennå.</p>}

      {data && !tomtVindu && (
        <div style={{ flex: 1, minHeight: 0, background: 'var(--navy-dark, #1B2A4A)', borderRadius: 10, padding: 12, border: '1px solid var(--glass-bg, rgba(255,255,255,0.06))' }}>
          <SensorGraf data={data} navn={meta?.navn ?? 'Verdi'} enhet={meta?.enhet ?? undefined} />
        </div>
      )}
    </div>
  );
}
