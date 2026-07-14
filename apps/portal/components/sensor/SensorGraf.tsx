'use client';

/**
 * uPlot-wrapper for én sensor-tidsserie. Klient-only (uPlot rører canvas/DOM) —
 * importeres via next/dynamic med ssr:false.
 *
 * - Linjefarge fra farge-enum (grafStroke): primary=live var(--gold), øvrige faste.
 * - Valgfri y-min/max (ellers auto). x-akse i Europe/Oslo, norsk format.
 * - spanGaps:false → null-verdier (data-gaps) bryter linjen.
 * - Rullende median-overlay (rolling, trailing 5 min) som «typisk verdi» — robust
 *   mot outliers. Egen turkis farge (distinkt fra gull rå-linje). Rent frontend,
 *   beregnes fra punkter-arrayen → generisk for BEGGE datakilder (Kusto + Azure SQL).
 * - Legende/tooltip viser klokkeslett i 24-t norsk med sekunder (Europe/Oslo).
 */
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { grafStroke, type Farge } from './farger';
import { rullendeMedian, MEDIAN_FARGE, MEDIAN_VINDU_SEK } from './median';

interface Props {
  data: uPlot.AlignedData;   // [tidspunkter(sek), verdier]
  navn: string;
  enhet?: string;
  farge?: Farge;
  yMin?: number | null;
  yMax?: number | null;
  medianVinduSek?: number;   // median-vindu fra graf-config; fallback = MEDIAN_VINDU_SEK
  medianFarge?: string;      // median-farge (hex) fra graf-config; fallback = MEDIAN_FARGE
}

function cssVar(navn: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(navn).trim();
  return v || fallback;
}

// x-akse-etiketter: kort format (HH:MM) — plass til mange ticks.
const klokke = new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });
// Legende/tooltip: fullt klokkeslett med sekunder, 24-t (Europe/Oslo).
const klokkeSekund = new Intl.DateTimeFormat('nb-NO', {
  timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** [xs, rå] → [xs, rå, median(vinduSek)] slik at median blir en egen uPlot-serie. */
function medMedian(data: uPlot.AlignedData, vinduSek: number): uPlot.AlignedData {
  const xs = data[0] as number[];
  const ys = data[1] as (number | null)[];
  return [xs, ys, rullendeMedian(xs, ys, vinduSek)];
}

/** Legende-etikett for vinduet: hele minutter → «X min», ellers «X s». */
function vinduLabel(sek: number): string {
  return sek % 60 === 0 ? `${sek / 60} min` : `${sek} s`;
}

export default function SensorGraf({ data, navn, enhet, farge = 'primary', yMin, yMax, medianVinduSek, medianFarge }: Props) {
  const vindu = medianVinduSek ?? MEDIAN_VINDU_SEK;   // backwards compat: udefinert → default 300
  const medFarge = medianFarge ?? MEDIAN_FARGE;       // backwards compat: udefinert → #00d4ff
  const boks = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = boks.current;
    if (!el) return;
    const tekst = () => cssVar('--text-secondary', 'rgba(255,255,255,0.7)');
    const rutenett = 'rgba(255,255,255,0.10)';
    const strek = grafStroke(farge);
    const etikett = `${navn}${enhet ? ` (${enhet})` : ''}`;

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
        // x-serie: styrer klokkeslett-format i legende/tooltip (HH:MM:SS, Europe/Oslo).
        { value: (_u, raw) => (raw == null ? '' : klokkeSekund.format(new Date(raw * 1000))) },
        // Rå måling — uendret (solid, full farge).
        { label: etikett, stroke: strek, width: 2, spanGaps: false },
        // Median-overlay: distinkt turkis + dashet → «typisk verdi» tydelig atskilt fra rå.
        { label: `${navn} · median (${vinduLabel(vindu)})`, stroke: medFarge, width: 2, dash: [6, 4], spanGaps: false },
      ],
    };
    const u = new uPlot(opts, medMedian(data, vindu), el);
    plot.current = u;
    return () => { u.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { plot.current?.setData(medMedian(data, vindu)); }, [data, vindu]);

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
