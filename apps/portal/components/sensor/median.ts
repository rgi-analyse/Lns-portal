/**
 * Rullende median for sensor-tidsserier. Delt mellom SensorGraf (overlay-serie)
 * og SensorGrafKort (header-verdi) — holdt uPlot-fritt så header-kortet ikke drar
 * inn uPlot via den dynamisk-lastede (ssr:false) grafen.
 *
 * Trailing vindu: median av punktene i (t − VINDU, t]. Bevisst IKKE sentrert —
 * sanntids-monitoring skal ikke bruke fremtidige punkter. 5 min gir tydeligere
 * trend enn kortere vindu (fanget for mye variasjon).
 */

export const MEDIAN_VINDU_SEK = 300;

// Distinkt turkis/cyan — klar separasjon fra gull rå-linje, komplementær, Fluent/Azure.
// Fast farge (ikke tema-avhengig): kontrollrommet er alltid navy på begge tema.
export const MEDIAN_FARGE = '#00d4ff';

function binInsert(sortert: number[], v: number): void {
  let lo = 0, hi = sortert.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sortert[m] < v) lo = m + 1; else hi = m; }
  sortert.splice(lo, 0, v);
}
function binRemove(sortert: number[], v: number): void {
  let lo = 0, hi = sortert.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sortert[m] < v) lo = m + 1; else hi = m; }
  if (sortert[lo] === v) sortert.splice(lo, 1);   // eksakt samme double vi satte inn
}
function medianAv(sortert: number[]): number {
  const n = sortert.length, mid = n >> 1;
  return n % 2 ? sortert[mid] : (sortert[mid - 1] + sortert[mid]) / 2;
}

/**
 * Median over trailing tidsvindu, ett punkt per xs. O(n·vindu) via glidende
 * sortert multiset (binærsøk-innsett/-fjern) — punktene er tids-sortert stigende.
 * Null der rå er null (samme gap-brudd som rå-linja) eller der vinduet er tomt.
 */
export function rullendeMedian(xs: number[], ys: (number | null)[], vinduSek = MEDIAN_VINDU_SEK): (number | null)[] {
  const ut: (number | null)[] = new Array(xs.length);
  const vindu: number[] = [];        // sorterte verdier i gjeldende vindu
  const køX: number[] = [];          // xs for ikke-null-verdiene (FIFO)
  const køV: number[] = [];
  let hode = 0;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (y != null) { binInsert(vindu, y); køX.push(xs[i]); køV.push(y); }
    const grense = xs[i] - vinduSek;
    while (hode < køX.length && køX[hode] < grense) { binRemove(vindu, køV[hode]); hode++; }
    ut[i] = (y == null || vindu.length === 0) ? null : medianAv(vindu);
  }
  return ut;
}

/**
 * Median-verdien «akkurat nå» = median av ikke-null-punktene i trailing-vinduet som
 * ender på siste tidspunkt. Samme verdi som siste punkt i rullendeMedian, men billig
 * (kun ett vindu) — til header-visning. Null hvis ingen verdier i vinduet.
 */
export function sisteMedianVerdi(xs: number[], ys: (number | null)[], vinduSek = MEDIAN_VINDU_SEK): number | null {
  if (xs.length === 0) return null;
  const grense = xs[xs.length - 1] - vinduSek;
  const verdier: number[] = [];
  for (let i = xs.length - 1; i >= 0; i--) {
    if (xs[i] < grense) break;       // xs sortert stigende → resten er eldre enn vinduet
    const y = ys[i];
    if (y != null) verdier.push(y);
  }
  if (verdier.length === 0) return null;
  verdier.sort((a, b) => a - b);
  return medianAv(verdier);
}
