'use client';

/**
 * uPlot-wrapper for én sensor-tidsserie. Klient-only (uPlot rører canvas/DOM) —
 * importeres via next/dynamic med ssr:false.
 *
 * - Linjefarge fra farge-enum (grafStroke): primary=live var(--gold), øvrige faste.
 * - Valgfri y-min/max (ellers auto). x-akse i Europe/Oslo, norsk format.
 * - spanGaps:false → null-verdier (data-gaps) bryter linjen.
 */
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { grafStroke, type Farge } from './farger';

interface Props {
  data: uPlot.AlignedData;   // [tidspunkter(sek), verdier]
  navn: string;
  enhet?: string;
  farge?: Farge;
  yMin?: number | null;
  yMax?: number | null;
}

function cssVar(navn: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(navn).trim();
  return v || fallback;
}

const klokke = new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });

export default function SensorGraf({ data, navn, enhet, farge = 'primary', yMin, yMax }: Props) {
  const boks = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = boks.current;
    if (!el) return;
    const tekst = () => cssVar('--text-secondary', 'rgba(255,255,255,0.7)');
    const rutenett = 'rgba(255,255,255,0.10)';

    const yScale: uPlot.Scale = (yMin != null || yMax != null)
      ? { range: (_u, dMin, dMax) => [yMin ?? dMin, yMax ?? dMax] }
      : {};

    const opts: uPlot.Options = {
      width: el.clientWidth || 800,
      height: el.clientHeight || 300,
      scales: { x: { time: true }, y: yScale },
      axes: [
        { stroke: tekst, grid: { stroke: rutenett, width: 1 }, ticks: { stroke: rutenett, width: 1 }, values: (_u, splits) => splits.map(s => klokke.format(new Date(s * 1000))) },
        { stroke: tekst, grid: { stroke: rutenett, width: 1 }, ticks: { stroke: rutenett, width: 1 } },
      ],
      series: [
        {},
        { label: `${navn}${enhet ? ` (${enhet})` : ''}`, stroke: grafStroke(farge), width: 2, spanGaps: false },
      ],
    };
    const u = new uPlot(opts, data, el);
    plot.current = u;
    return () => { u.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { plot.current?.setData(data); }, [data]);

  // Auto-resize: re-tegn uPlot når containeren endrer størrelse (viewport ELLER
  // flex-omfordeling når antall grafer endres). ResizeObserver fanger begge.
  useEffect(() => {
    const el = boks.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (plot.current) plot.current.setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return <div ref={boks} style={{ width: '100%', height: '100%' }} />;
}
