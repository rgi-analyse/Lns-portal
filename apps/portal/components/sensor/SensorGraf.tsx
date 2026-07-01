'use client';

/**
 * uPlot-wrapper for sensor-tidsserie. Klient-only (uPlot rører canvas/DOM) —
 * importeres via next/dynamic med ssr:false fra siden.
 *
 * Steg 4b — tema-integrert:
 * - Gull-linje (var(--primary)) på navy graf-flate (satt av containeren).
 * - Akse-tekst/rutenett fra var(--text-secondary). Canvas trenger konkrete
 *   farger → CSS-variabler resolves via getComputedStyle.
 * - X-akse i Europe/Oslo, norsk format (Intl 'nb-NO'). Norge har heltalls
 *   UTC-offset, så uPlot sin tick-plassering trenger ingen tzDate — det holder
 *   å formatere selve etikettene i Oslo-tid.
 * - spanGaps:false → null-verdier (fra data-gaps) bryter linjen.
 */
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface Props {
  data: uPlot.AlignedData;   // [tidspunkter(sek), verdier]
  navn: string;
  enhet?: string;
}

function cssVar(navn: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(navn).trim();
  return v || fallback;
}

const klokke = new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });

export default function SensorGraf({ data, navn, enhet }: Props) {
  const boks = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = boks.current;
    if (!el) return;
    const gull = cssVar('--primary', '#F5A623');
    const tekst = cssVar('--text-secondary', '#94a3b8');
    const rutenett = 'rgba(148,163,184,0.15)';

    const opts: uPlot.Options = {
      width: el.clientWidth || 800,
      height: el.clientHeight || 400,
      scales: { x: { time: true } },
      axes: [
        {
          stroke: tekst,
          grid: { stroke: rutenett, width: 1 },
          ticks: { stroke: rutenett, width: 1 },
          values: (_u, splits) => splits.map(s => klokke.format(new Date(s * 1000))),
        },
        {
          stroke: tekst,
          grid: { stroke: rutenett, width: 1 },
          ticks: { stroke: rutenett, width: 1 },
        },
      ],
      series: [
        {},
        { label: `${navn}${enhet ? ` (${enhet})` : ''}`, stroke: gull, width: 2, spanGaps: false },
      ],
    };
    const u = new uPlot(opts, data, el);
    plot.current = u;
    return () => { u.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Oppdater data uten å re-opprette instansen.
  useEffect(() => { plot.current?.setData(data); }, [data]);

  // Hold størrelsen i sync med containeren.
  useEffect(() => {
    const el = boks.current;
    const onResize = () => {
      if (el && plot.current) plot.current.setSize({ width: el.clientWidth, height: el.clientHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return <div ref={boks} style={{ width: '100%', height: '100%' }} />;
}
