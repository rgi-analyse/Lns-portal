'use client';

/**
 * Sensor-kontrollrom (Steg 5c). [id] = SensorDashbord-ID.
 * Henter dashbord-konfig og rendrer N grafer (vertikal stack), med tidsvindu +
 * oppdaterings-intervall + per-graf farge/y-min-max fra konfig. Fullskjerm:
 * dashboard-layouten hopper over sidebar/topbar for /dashboard/sensorer/*.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import SensorGrafKort from '@/components/sensor/SensorGrafKort';
import type { Farge } from '@/components/sensor/farger';

interface GrafKonfig { sensorId: string; tittel: string; yMin?: number | null; yMax?: number | null; farge: Farge; medianVinduSek?: number }
interface Dashbord {
  navn: string;
  tidsvinduMinutter: number;
  oppdateringsIntervallSek: number;
  konfig: { layout: string; grafer: GrafKonfig[]; visSensorNavn: boolean; visSisteVerdi: boolean } | null;
}
interface SensorMeta { id: string; enhet?: string | null }

const datoFmt = new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', day: '2-digit', month: '2-digit', year: '2-digit' });

export default function SensorKontrollrom() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const { authHeaders, grupper, authAvklart, isAuthenticated } = usePortalAuth();

  const [dashbord, setDashbord] = useState<Dashbord | null>(null);
  const [enhetMap, setEnhetMap] = useState<Record<string, string | undefined>>({});
  const [feil, setFeil] = useState<string | null>(null);
  const [laster, setLaster] = useState(true);
  const aktiv = authAvklart && isAuthenticated && !!id;

  useEffect(() => {
    if (!authAvklart) return;
    if (!aktiv) { setLaster(false); return; }
    let avbrutt = false;
    (async () => {
      setLaster(true); setFeil(null);
      try {
        const gq = grupper.length ? `?grupper=${encodeURIComponent(grupper.join(','))}` : '';
        const dRes = await apiFetch(`/api/sensor-dashbord/${id}${gq}`, { headers: authHeaders });
        if (!dRes.ok) {
          const k = await dRes.json().catch(() => ({})) as { error?: string };
          throw new Error(k.error ?? `HTTP ${dRes.status}`);
        }
        const d = await dRes.json() as Dashbord;
        const sRes = await apiFetch(`/api/sensor${gq}`, { headers: authHeaders });
        const sensorer: SensorMeta[] = sRes.ok ? await sRes.json() : [];
        if (avbrutt) return;
        setDashbord(d);
        setEnhetMap(Object.fromEntries(sensorer.map(s => [s.id, s.enhet ?? undefined])));
      } catch (e) {
        if (!avbrutt) setFeil(e instanceof Error ? e.message : 'Ukjent feil');
      } finally {
        if (!avbrutt) setLaster(false);
      }
    })();
    return () => { avbrutt = true; };
  }, [id, authAvklart, aktiv, authHeaders, grupper]);

  const grafer = dashbord?.konfig?.grafer ?? [];
  const visSisteVerdi = dashbord?.konfig?.visSisteVerdi ?? true;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--navy-darkest, #0a1628)', display: 'flex', flexDirection: 'column', padding: 16, gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0, color: 'var(--gold, #ffbb00)', fontSize: 18, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {dashbord?.navn ?? 'Kontrollrom'}
        </h1>
        {dashbord && (
          <span style={{ color: 'var(--text-secondary, rgba(255,255,255,0.7))', fontSize: 13 }}>
            {datoFmt.format(new Date())} · siste {dashbord.tidsvinduMinutter} min · hvert {dashbord.oppdateringsIntervallSek}s · Europe/Oslo
          </span>
        )}
      </div>

      {authAvklart && !isAuthenticated && <p style={{ color: 'rgba(255,255,255,0.7)' }}>Du må være innlogget.</p>}
      {laster && <p style={{ color: 'rgba(255,255,255,0.7)' }}>Laster dashbord …</p>}
      {feil && <p style={{ color: '#f87171' }}>Kunne ikke hente dashbord: {feil}</p>}
      {dashbord && grafer.length === 0 && !feil && <p style={{ color: 'rgba(255,255,255,0.7)' }}>Dashbordet har ingen grafer.</p>}

      {dashbord && grafer.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {grafer.map((g, i) => (
            <SensorGrafKort
              key={`${g.sensorId}-${i}`}
              sensorId={g.sensorId}
              tittel={g.tittel}
              enhet={enhetMap[g.sensorId]}
              farge={g.farge}
              yMin={g.yMin}
              yMax={g.yMax}
              medianVinduSek={g.medianVinduSek}
              tidsvinduMin={dashbord.tidsvinduMinutter}
              intervallSek={dashbord.oppdateringsIntervallSek}
              visSisteVerdi={visSisteVerdi}
              authHeaders={authHeaders}
              grupper={grupper}
              aktiv={aktiv}
            />
          ))}
        </div>
      )}
    </div>
  );
}
