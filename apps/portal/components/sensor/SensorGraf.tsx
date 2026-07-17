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
 * - Grenseverdier (KPI) som horisontale linjer via draw-hook — ren overlay, rører
 *   ALDRI y-skalaen (data styrer oppløsningen alene). Se tegnGrenseverdier.
 */
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { grafStroke, type Farge } from './farger';
import { rullendeMedian, MEDIAN_FARGE, MEDIAN_VINDU_SEK } from './median';
import { grenseFarge, type Grenseverdi } from './grenseverdier';

interface Props {
  data: uPlot.AlignedData;   // [tidspunkter(sek), verdier]
  navn: string;
  enhet?: string;
  farge?: Farge;
  yMin?: number | null;
  yMax?: number | null;
  medianVinduSek?: number;   // median-vindu fra graf-config; fallback = MEDIAN_VINDU_SEK
  medianFarge?: string;      // median-farge (hex) fra graf-config; fallback = MEDIAN_FARGE
  grenseverdier?: Grenseverdi[];   // KPI-linjer fra graf-config; udefinert/tom = ingen linjer
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

/**
 * Tegner grenseverdi-linjene på toppen av seriene (draw-hook kjører etter drawSeries,
 * og på HVER tegning → følger automatisk resize/reflow).
 *
 * Y-skalaen røres bevisst ikke: en grense langt utenfor dataområdet ville ellers zoomet
 * ut streamingdata til en flat strek. I stedet clip-sjekkes hver linje mot gjeldende
 * y-område — utenfor → hoppes helt over (ingen linje, ingen etikett). Linja dukker opp
 * av seg selv når data nærmer seg grensen.
 */
function tegnGrenseverdier(u: uPlot, grenser: Grenseverdi[]): void {
  if (grenser.length === 0) return;
  const yMin = u.scales.y.min, yMax = u.scales.y.max;
  if (yMin == null || yMax == null) return;   // ingen data ennå → ingenting å tegne mot

  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const dpr = (typeof window === 'undefined' ? 1 : window.devicePixelRatio) || 1;

  ctx.save();
  // Clip til plot-området: etikett nær kanten kan aldri lekke ut over aksene.
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.lineWidth = 1.5 * dpr;
  ctx.setLineDash([]);   // median-serien tegnes dashet — nullstill så grensa blir heltrukket
  // canvas font-shorthand kan ikke parse var() → resolver CSS-variabelen først.
  ctx.font = `${11 * dpr}px ${cssVar('--font-segoe', 'system-ui, sans-serif')}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';

  for (const gv of grenser) {
    if (!Number.isFinite(gv.verdi)) continue;
    if (gv.verdi < yMin || gv.verdi > yMax) continue;   // utenfor dataområdet → tegn ikke

    const y = Math.round(u.valToPos(gv.verdi, 'y', true));
    const farge = grenseFarge(gv.farge);   // hex-guard: ugyldig/tom → default rød

    ctx.strokeStyle = farge;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.stroke();

    const etikett = gv.etikett?.trim();
    if (etikett) {
      ctx.fillStyle = farge;
      ctx.fillText(etikett, left + width - 6 * dpr, y - 3 * dpr);
    }
  }
  ctx.restore();
}

export default function SensorGraf({ data, navn, enhet, farge = 'primary', yMin, yMax, medianVinduSek, medianFarge, grenseverdier }: Props) {
  const vindu = medianVinduSek ?? MEDIAN_VINDU_SEK;   // backwards compat: udefinert → default 300
  const medFarge = medianFarge ?? MEDIAN_FARGE;       // backwards compat: udefinert → #00d4ff
  const boks = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  // Grensene leses via ref inne i draw-hooken (opts bygges kun én gang, og hooken
  // kjører på hver tegning) → endret konfig slår gjennom uten å bygge plottet på nytt.
  const grenser = useRef<Grenseverdi[]>(grenseverdier ?? []);
  grenser.current = grenseverdier ?? [];

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
      // Grenseverdi-overlay. draw kjører etter drawSeries → linjene legger seg øverst,
      // og kjøres på hver tegning (setData, setSize/resize, tema-reflow).
      hooks: { draw: [(u: uPlot) => tegnGrenseverdier(u, grenser.current)] },
    };
    const u = new uPlot(opts, medMedian(data, vindu), el);
    plot.current = u;
    return () => { u.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { plot.current?.setData(medMedian(data, vindu)); }, [data, vindu]);

  // Endret grense-konfig uten nye data (f.eks. admin-preview) → tving én tegning.
  // rebuildPaths=false: serie-stiene er uendret, kun overlayet skal på nytt.
  //
  // status===1-gaten er IKKE defensiv pynt: uPlots konstruktør tegner ikke synkront —
  // den setter shouldConvergeSize=true og køer første _commit på microtask-køen. Denne
  // effekten kjører synkront i samme React-commit, altså FØR den microtasken. Og
  // redraw(rebuildPaths, recalcAxes) SETTER shouldConvergeSize = recalcAxes || false —
  // den or-er ikke. Et ugatet redraw(false) her nullstiller derfor konstruktørens
  // ventende flagg, første commit hopper over akse-sizingen (axesCalc), og axis._found
  // forblir null mens axis._show står igjen på init-verdien true. Akse-tegningen guarder
  // kun på _show og destrukturerer _found → «object null is not iterable».
  // Grensene går ikke tapt av å hoppe over: første commit tegner dem uansett via
  // draw-hooken, som leser grenser.current.
  const grenserNokkel = JSON.stringify(grenseverdier ?? []);
  useEffect(() => {
    const u = plot.current;
    if (u && u.status === 1) u.redraw(false);
  }, [grenserNokkel]);

  // Auto-resize: re-tegn uPlot når containeren endrer størrelse (vindusendring,
  // grid-reflow i rutenett-2, eller flex-omfordeling når antall grafer endres).
  // ResizeObserver fanger alle. setSize coalesces via rAF → unngår layout-thrash
  // og «ResizeObserver loop»-warning (setSize inne i RO-callback ville kunne loope).
  useEffect(() => {
    const el = boks.current;
    if (!el) return;
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!plot.current) return;
        const w = el.clientWidth, h = el.clientHeight;
        if (w > 0 && h > 0) plot.current.setSize({ width: w, height: h });
      });
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(rafId); ro.disconnect(); };
  }, []);

  return <div ref={boks} style={{ width: '100%', height: '100%' }} />;
}
