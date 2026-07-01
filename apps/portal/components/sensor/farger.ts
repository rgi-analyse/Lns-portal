/** Farge-enum for dashbord-grafer + mapping til swatch/uPlot-canvas-farger. */
export const FARGER = ['primary', 'accent', 'success', 'warning', 'danger'] as const;
export type Farge = typeof FARGER[number];

// Statiske hex-farger for swatch/tekst i admin-UI. primary vises som gull.
export const FARGE_HEX: Record<Farge, string> = {
  primary: '#ffbb00', accent: '#38bdf8', success: '#22c55e', warning: '#f59e0b', danger: '#ef4444',
};

export const FARGE_NAVN: Record<Farge, string> = {
  primary: 'Gull (primary)', accent: 'Blå (accent)', success: 'Grønn (success)', warning: 'Oransje (warning)', danger: 'Rød (danger)',
};

/** CSS-verdi for tekst (primary → live var(--gold), følger tema). */
export function fargeTekst(farge: Farge): string {
  return farge === 'primary' ? 'var(--gold, #ffbb00)' : FARGE_HEX[farge];
}

/**
 * uPlot canvas-strokeStyle. primary → funksjon som resolver var(--gold) live
 * (følger tema-endring); øvrige → faste semantiske hex-farger.
 */
export function grafStroke(farge: Farge): string | (() => string) {
  if (farge !== 'primary') return FARGE_HEX[farge];
  return () => {
    if (typeof window === 'undefined') return '#ffbb00';
    const v = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim();
    return v || '#ffbb00';
  };
}
