import { Resvg } from '@resvg/resvg-js';

// ─────────────────────────────────────────────
// Typer
// ─────────────────────────────────────────────

export interface GrafFarger {
  primær: string;       // hovedfarge for søyler/segmenter
  bakgrunn: string;     // bakgrunn for hele graf
  navy: string;         // mellomtone for variasjon
  aksent: string;       // sekundær variasjon
  tekst: string;        // tekstfarge
  tekstMuted: string;   // dempet tekst (akser, grid)
}

export interface BarVertikalSpec {
  type: 'bar_vertikal';
  xKolonne: string;
  yKolonne: string;
  tittel?: string;
  xFormat?: 'aarmaaned' | 'tekst';  // 'aarmaaned' → 202601 vises som "Jan 2026"
}

export interface BarHorisontalSpec {
  type: 'bar_horisontal';
  xKolonne: string;     // verdier
  yKolonne: string;     // kategorier
  tittel?: string;
}

export interface PieSpec {
  type: 'pie';
  labelKolonne: string;
  verdiKolonne: string;
  tittel?: string;
}

export type GrafSpec = BarVertikalSpec | BarHorisontalSpec | PieSpec;

// ─────────────────────────────────────────────
// Konstanter
// ─────────────────────────────────────────────

const W = 1200;
const H = 800;

// ─────────────────────────────────────────────
// Hjelpere
// ─────────────────────────────────────────────

function formaterTall(n: number, desimaler = 0): string {
  return n.toLocaleString('nb-NO', {
    minimumFractionDigits: desimaler,
    maximumFractionDigits: desimaler,
  });
}

function formaterAarMaaned(aarmaaned: number | string): string {
  const s = String(aarmaaned);
  const aar = s.substring(0, 4);
  const mnd = parseInt(s.substring(4, 6), 10);
  const navn = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${navn[mnd - 1] ?? s} ${aar}`;
}

// XML-escaping for tekst som settes inn i SVG (navn kan inneholde & < > " ').
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tall(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function bakgrunn(farger: GrafFarger): string {
  return `<rect x="0" y="0" width="${W}" height="${H}" fill="${esc(farger.bakgrunn)}"/>`;
}

function tittelSvg(tittel: string | undefined, farger: GrafFarger): string {
  if (!tittel) return '';
  return `<text x="${W / 2}" y="48" font-family="sans-serif" font-size="28" font-weight="bold" fill="${esc(farger.tekst)}" text-anchor="middle">${esc(tittel)}</text>`;
}

function tomGraf(tittel: string | undefined, farger: GrafFarger): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${bakgrunn(farger)}${tittelSvg(tittel, farger)}<text x="${W / 2}" y="${H / 2}" font-family="sans-serif" font-size="24" fill="${esc(farger.tekstMuted)}" text-anchor="middle">Ingen data</text></svg>`;
}

// ─────────────────────────────────────────────
// bar_vertikal
// ─────────────────────────────────────────────

function lagBarVertikalSvg(
  data: Record<string, unknown>[],
  spec: BarVertikalSpec,
  farger: GrafFarger,
): string {
  if (data.length === 0) return tomGraf(spec.tittel, farger);

  const padTop = 80, padBottom = 60, padLeft = 100, padRight = 60;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  const verdier = data.map(r => tall(r[spec.yKolonne]));
  const vmax = Math.max(0, ...verdier);
  const vmin = Math.min(0, ...verdier);
  const range = (vmax - vmin) || 1;

  const yFor = (v: number) => padTop + plotH * ((vmax - v) / range);
  const zeroY = yFor(0);

  const n = data.length;
  const slot = plotW / n;
  const barW = slot * 0.6;

  const deler: string[] = [bakgrunn(farger), tittelSvg(spec.tittel, farger)];

  // Grid: 5 horisontale linjer + verdi-labels på y-aksen
  const linjer = 5;
  for (let i = 0; i <= linjer; i++) {
    const v = vmax - (range * i) / linjer;
    const y = yFor(v);
    deler.push(`<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${padLeft + plotW}" y2="${y.toFixed(1)}" stroke="${esc(farger.tekstMuted)}" stroke-width="1" opacity="0.25"/>`);
    deler.push(`<text x="${padLeft - 12}" y="${(y + 5).toFixed(1)}" font-family="sans-serif" font-size="16" fill="${esc(farger.tekstMuted)}" text-anchor="end">${esc(formaterTall(v))}</text>`);
  }

  // Null-linje tydeligere hvis negative verdier finnes
  if (vmin < 0) {
    deler.push(`<line x1="${padLeft}" y1="${zeroY.toFixed(1)}" x2="${padLeft + plotW}" y2="${zeroY.toFixed(1)}" stroke="${esc(farger.tekstMuted)}" stroke-width="2" opacity="0.7"/>`);
  }

  data.forEach((r, idx) => {
    const v = verdier[idx];
    const cx = padLeft + slot * idx + slot / 2;
    const x = cx - barW / 2;
    const yV = yFor(v);
    const y = Math.min(zeroY, yV);
    const høyde = Math.abs(yV - zeroY);

    deler.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, høyde).toFixed(1)}" fill="${esc(farger.primær)}" rx="2"/>`);

    // Verdi-label: positive over søyle-tuppen (lys tekst); negative inne ved
    // toppen av søylen med mørk tekst — unngår kollisjon med x-akse-labels
    // når søylen når bunnen av plottet.
    let labelY: number;
    let labelFill: string;
    if (v >= 0) {
      labelY = yV - 10;
      labelFill = farger.tekst;
    } else {
      labelY = zeroY + 24;
      labelFill = farger.bakgrunn;
    }
    deler.push(`<text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" font-family="sans-serif" font-size="16" fill="${esc(labelFill)}" text-anchor="middle">${esc(formaterTall(v))}</text>`);

    // X-akse-label
    const rå = r[spec.xKolonne];
    const xLabel = spec.xFormat === 'aarmaaned' ? formaterAarMaaned(rå as string | number) : String(rå ?? '');
    deler.push(`<text x="${cx.toFixed(1)}" y="${(H - padBottom + 28).toFixed(1)}" font-family="sans-serif" font-size="16" fill="${esc(farger.tekstMuted)}" text-anchor="middle">${esc(xLabel)}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${deler.join('')}</svg>`;
}

// ─────────────────────────────────────────────
// bar_horisontal
// ─────────────────────────────────────────────

function lagBarHorisontalSvg(
  data: Record<string, unknown>[],
  spec: BarHorisontalSpec,
  farger: GrafFarger,
): string {
  if (data.length === 0) return tomGraf(spec.tittel, farger);

  const padTop = 80, padBottom = 60, padLeft = 220, padRight = 80;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  const sortert = [...data].sort((a, b) => tall(b[spec.xKolonne]) - tall(a[spec.xKolonne]));

  // Skaler på største absoluttverdi så negative også får synlig (liten) søyle.
  const maksAbs = Math.max(1, ...sortert.map(r => Math.abs(tall(r[spec.xKolonne]))));

  const n = sortert.length;
  const slot = plotH / n;
  const barH = slot * 0.6;

  const deler: string[] = [bakgrunn(farger), tittelSvg(spec.tittel, farger)];

  // Y-akse
  deler.push(`<line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotH}" stroke="${esc(farger.tekstMuted)}" stroke-width="2" opacity="0.7"/>`);

  sortert.forEach((r, idx) => {
    const v = tall(r[spec.xKolonne]);
    const cy = padTop + slot * idx + slot / 2;
    const y = cy - barH / 2;
    const bredde = Math.max(2, (Math.abs(v) / maksAbs) * plotW);

    deler.push(`<rect x="${padLeft}" y="${y.toFixed(1)}" width="${bredde.toFixed(1)}" height="${barH.toFixed(1)}" fill="${esc(farger.primær)}" rx="2"/>`);

    // Kategori-label (venstre for aksen, høyrejustert i venstremargen)
    const kat = String(r[spec.yKolonne] ?? '');
    const katKort = kat.length > 32 ? kat.slice(0, 31) + '…' : kat;
    deler.push(`<text x="${padLeft - 12}" y="${(cy + 5).toFixed(1)}" font-family="sans-serif" font-size="16" fill="${esc(farger.tekst)}" text-anchor="end">${esc(katKort)}</text>`);

    // Verdi på enden av søylen. Hvis søylen er så bred at labelen ville
    // gått utenfor høyre kant, plasseres den inne i søyle-enden med mørk
    // tekst i stedet (unngår klipping).
    const labelTekst = formaterTall(v);
    const estLabelBredde = labelTekst.length * 9 + 12;
    const utenforX = padLeft + bredde + 10;
    if (utenforX + estLabelBredde > W - 4) {
      deler.push(`<text x="${(padLeft + bredde - 10).toFixed(1)}" y="${(cy + 5).toFixed(1)}" font-family="sans-serif" font-size="16" fill="${esc(farger.bakgrunn)}" text-anchor="end">${esc(labelTekst)}</text>`);
    } else {
      deler.push(`<text x="${utenforX.toFixed(1)}" y="${(cy + 5).toFixed(1)}" font-family="sans-serif" font-size="16" fill="${esc(farger.tekst)}" text-anchor="start">${esc(labelTekst)}</text>`);
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${deler.join('')}</svg>`;
}

// ─────────────────────────────────────────────
// pie
// ─────────────────────────────────────────────

function segmentFarge(idx: number, farger: GrafFarger): { fill: string; opacity: number } {
  if (idx === 0) return { fill: farger.primær, opacity: 1 };
  if (idx === 1) return { fill: farger.aksent, opacity: 1 };
  const opaciteter = [0.7, 0.5, 0.35, 0.25];
  return { fill: farger.primær, opacity: opaciteter[(idx - 2) % opaciteter.length] };
}

function lagPieSvg(
  data: Record<string, unknown>[],
  spec: PieSpec,
  farger: GrafFarger,
): string {
  if (data.length === 0) return tomGraf(spec.tittel, farger);

  const segmenter = [...data]
    .map(r => ({ navn: String(r[spec.labelKolonne] ?? ''), verdi: Math.abs(tall(r[spec.verdiKolonne])) }))
    .filter(s => s.verdi > 0)
    .sort((a, b) => b.verdi - a.verdi);

  if (segmenter.length === 0) return tomGraf(spec.tittel, farger);

  const total = segmenter.reduce((s, x) => s + x.verdi, 0) || 1;

  const cx = W / 2;
  const cy = 430;
  const r = 200;

  const deler: string[] = [bakgrunn(farger), tittelSvg(spec.tittel, farger)];

  let v0 = -Math.PI / 2;  // start kl. 12
  segmenter.forEach((seg, idx) => {
    const andel = seg.verdi / total;
    const v1 = v0 + andel * 2 * Math.PI;
    const x1 = cx + r * Math.cos(v0);
    const y1 = cy + r * Math.sin(v0);
    const x2 = cx + r * Math.cos(v1);
    const y2 = cy + r * Math.sin(v1);
    const stor = (v1 - v0) > Math.PI ? 1 : 0;
    const { fill, opacity } = segmentFarge(idx, farger);

    // Heltallssirkel hvis ett segment = 100 %
    if (segmenter.length === 1) {
      deler.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${esc(fill)}" opacity="${opacity}"/>`);
    } else {
      deler.push(`<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${stor} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${esc(fill)}" opacity="${opacity}"/>`);
    }

    // Label ved siden av segmentet
    const vMid = (v0 + v1) / 2;
    const lx = cx + (r + 30) * Math.cos(vMid);
    const ly = cy + (r + 30) * Math.sin(vMid);
    const anker = Math.cos(vMid) >= 0 ? 'start' : 'end';
    const pst = (andel * 100).toFixed(1).replace('.', ',');
    deler.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-family="sans-serif" font-size="16" fill="${esc(farger.tekst)}" text-anchor="${anker}">${esc(seg.navn)} (${pst} %)</text>`);

    v0 = v1;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${deler.join('')}</svg>`;
}

// ─────────────────────────────────────────────
// SVG → PNG
// ─────────────────────────────────────────────

function svgTilPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { loadSystemFonts: true },
  });
  return Buffer.from(resvg.render().asPng());
}

// ─────────────────────────────────────────────
// Offentlig API
// ─────────────────────────────────────────────

export async function lagGrafPng(
  spec: GrafSpec,
  data: Record<string, unknown>[],
  farger: GrafFarger,
): Promise<Buffer> {
  let svg: string;
  switch (spec.type) {
    case 'bar_vertikal':
      svg = lagBarVertikalSvg(data, spec, farger);
      break;
    case 'bar_horisontal':
      svg = lagBarHorisontalSvg(data, spec, farger);
      break;
    case 'pie':
      svg = lagPieSvg(data, spec, farger);
      break;
  }
  return svgTilPng(svg);
}
