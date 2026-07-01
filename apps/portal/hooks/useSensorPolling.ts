'use client';

/**
 * Live-polling av sensor-tidsserie med delta-fetch + sliding window.
 *
 * - Første kall: siste `tidsvinduMin` minutter.
 * - Etterfølgende: delta (?siden=<siste-ts>), appender kun nye punkter.
 * - Sliding window: dropper punkter eldre enn tidsvindu (konstant minne).
 * - Pauser når fanen er skjult (document.hidden) for å spare Eventhouse.
 * - Intervall klampes 2–60 s.
 * - Data-gaps (>10 s uten punkt) bryter linjen med en null (uPlot spanGaps:false).
 */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import type uPlot from 'uplot';

interface Punkt { ts: string; value: number | null }

const GAP_MS = 10_000; // over ~1,5 s-frekvens → reell gap → null-brudd
const klampIntervall = (sek: number): number => Math.min(60, Math.max(2, Math.round(sek)));

function tilAlignedData(punkter: Punkt[]): uPlot.AlignedData {
  const xs: number[] = [];
  const ys: (number | null)[] = [];
  for (let i = 0; i < punkter.length; i++) {
    const t = Date.parse(punkter[i].ts);
    if (i > 0) {
      const forrige = Date.parse(punkter[i - 1].ts);
      if (t - forrige > GAP_MS) { xs.push((forrige + 1000) / 1000); ys.push(null); }
    }
    xs.push(t / 1000);
    ys.push(punkter[i].value);
  }
  return [xs, ys];
}

export interface SensorPollingResultat {
  data: uPlot.AlignedData | null;
  feil: string | null;
  laster: boolean;
}

export function useSensorPolling(opts: {
  sensorId: string;
  intervallSek: number;
  tidsvinduMin: number;
  authHeaders: Record<string, string>;
  grupper: string[];
  aktiv: boolean;
}): SensorPollingResultat {
  const { sensorId, tidsvinduMin, authHeaders, grupper, aktiv } = opts;
  const intervallMs = klampIntervall(opts.intervallSek) * 1000;
  const grupperKey = grupper.join(',');

  const bufferRef = useRef<Punkt[]>([]);
  const sisteRef = useRef<string>('');
  const [data, setData] = useState<uPlot.AlignedData | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [laster, setLaster] = useState(true);

  useEffect(() => {
    if (!aktiv || !sensorId) return;

    // Reset ved sensor-/konfig-endring.
    bufferRef.current = [];
    sisteRef.current = new Date(Date.now() - tidsvinduMin * 60_000).toISOString();
    setData(null); setFeil(null); setLaster(true);

    let stoppet = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const hent = async (): Promise<void> => {
      try {
        const params = new URLSearchParams({ siden: sisteRef.current });
        if (grupperKey) params.set('grupper', grupperKey);
        const res = await apiFetch(`/api/sensor/${sensorId}/data?${params.toString()}`, { headers: authHeaders });
        if (!res.ok) {
          const kropp = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(kropp.error ?? `HTTP ${res.status}`);
        }
        const { punkter } = await res.json() as { punkter: Punkt[] };
        if (stoppet) return;

        if (punkter.length > 0) {
          bufferRef.current = bufferRef.current.concat(punkter);
          sisteRef.current = punkter[punkter.length - 1].ts;
        }
        // Sliding window — dropp punkter eldre enn tidsvindu.
        const grense = Date.now() - tidsvinduMin * 60_000;
        bufferRef.current = bufferRef.current.filter(p => Date.parse(p.ts) >= grense);

        setData(tilAlignedData(bufferRef.current));
        setFeil(null);
      } catch (e) {
        if (!stoppet) setFeil(e instanceof Error ? e.message : 'Ukjent feil');
      } finally {
        if (!stoppet) setLaster(false);
      }
    };

    const start = (): void => { if (!timer) timer = setInterval(hent, intervallMs); };
    const stopp = (): void => { if (timer) { clearInterval(timer); timer = null; } };
    const påSynlighet = (): void => {
      if (document.hidden) stopp();
      else { void hent(); start(); }   // hent umiddelbart ved retur + gjenoppta
    };

    void hent();
    start();
    document.addEventListener('visibilitychange', påSynlighet);

    return () => {
      stoppet = true;
      stopp();
      document.removeEventListener('visibilitychange', påSynlighet);
    };
  }, [sensorId, tidsvinduMin, intervallMs, authHeaders, grupperKey, aktiv]);

  return { data, feil, laster };
}
