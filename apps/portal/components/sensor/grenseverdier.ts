/**
 * Grenseverdier/KPI (maks, min, alarm …) for sensor-grafer: horisontale linjer
 * konfigurert per graf. Delt mellom admin-skjema og kontrollrom.
 *
 * Bevisst uPlot-fritt (som median.ts) → kan importeres av kort/skjema uten å dra
 * inn den dynamisk-lastede (ssr:false) grafen.
 *
 * Grenselinjer er REN overlay: de påvirker aldri y-skalaen. SensorGraf tegner kun
 * linjer som ligger innenfor dataens eget y-område, slik at streamingdata alltid
 * beholder full oppløsning.
 */

/** Default rød — «grense/alarm» semantisk, distinkt fra gull rå og turkis median. */
export const GRENSE_FARGE = '#ff4444';

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export interface Grenseverdi {
  verdi: number;
  farge?: string;      // rå hex; ugyldig/tom → GRENSE_FARGE
  etikett?: string;    // valgfri tekst, f.eks. «Maks», «Alarm»
}

/** Hex-guard: ugyldig/tom farge → default (aldri usynlig/krasj). Speiler medianFarge-mønsteret. */
export function grenseFarge(farge?: string): string {
  return farge && HEX_RE.test(farge.trim()) ? farge.trim() : GRENSE_FARGE;
}
