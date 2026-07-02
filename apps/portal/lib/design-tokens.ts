/**
 * Design-tokens (Fase D1) — Microsoft/Azure/Fabric-inspirert.
 *
 * Ren data (ingen React/DOM) så den kan importeres av både komponenter og
 * tailwind.config.ts. Brand-farger (gull) er per-tenant via CSS-variabler
 * (var(--gold) osv.); Azure/Microsoft semantiske + nøytrale farger er faste.
 *
 * D1 = fundament + 3 POC-komponenter. Global anvendelse skjer i D2.
 */

/** Segoe UI-stack (system-font, ingen CDN-lasting). Semibold=600 for headers. */
export const fontFamily = {
  segoe: '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif',
} as const;

/** Azure-inspirerte størrelser (kompakt; H1 mindre enn tradisjonelt). */
export const fontSize = {
  small:  '12px',
  body:   '14px',
  h4:     '14px',
  h3:     '16px',
  h2:     '18px',
  h1:     '24px',
  tabell: '13px',
} as const;

export const fontWeight = {
  light:    300,   // Segoe UI Light — large display
  regular:  400,   // body
  semibold: 600,   // headers / knapper
} as const;

export const lineHeight = {
  tight:   1.2,
  normal:  1.4,
  relaxed: 1.6,
} as const;

export const colors = {
  /** Merkevare — per tenant via CSS-variabler (LNS = gull #ffbb00). */
  brand: {
    primary:     'var(--gold, #ffbb00)',
    primaryText: 'var(--primary-text, #ffffff)',
  },
  /** Azure/Microsoft semantiske farger (faste, tenant-uavhengige). */
  semantic: {
    info:    '#0078D4',   // Azure Blue
    success: '#107C10',   // Microsoft green
    warning: '#FFB900',   // Microsoft yellow
    danger:  '#D13438',   // Microsoft red
  },
  /** Microsoft neutral-palett (Fluent grays). */
  neutral: {
    white:   '#FFFFFF',
    grey20:  '#F3F2F1',
    grey40:  '#E1DFDD',
    grey60:  '#C8C6C4',
    grey90:  '#A19F9D',
    grey110: '#8A8886',
    grey130: '#605E5C',
    grey160: '#323130',
    black:   '#000000',
  },
  /** Flater (navy) — per tenant. */
  surface: {
    darkest: 'var(--navy-darkest, #0a1628)',
    dark:    'var(--navy-dark, #1B2A4A)',
    base:    'var(--navy, #1e242d)',
  },
  text: {
    primary:   'var(--text-primary, rgba(255,255,255,0.95))',
    secondary: 'var(--text-secondary, rgba(255,255,255,0.70))',
    muted:     'var(--text-muted, rgba(255,255,255,0.45))',
  },
  border: 'var(--glass-border, rgba(255,255,255,0.12))',
} as const;

/** 4px-basert spacing-skala (Azure-tetthet). */
export const spacing = {
  0:  '0',
  1:  '4px',
  2:  '8px',
  3:  '12px',
  4:  '16px',
  6:  '24px',
  8:  '32px',
} as const;

/** Små radii (Azure): buttons 2, cards 4, modals 8. */
export const radii = {
  small:  '2px',
  medium: '4px',
  large:  '8px',
} as const;

/** Subtile, harde skygger. Elevation drives primært av border+background. */
export const shadows = {
  elevation1: '0 1px 2px rgba(0,0,0,0.24)',
  elevation2: '0 2px 4px rgba(0,0,0,0.28)',
  elevation3: '0 4px 8px rgba(0,0,0,0.32)',
} as const;

export const transitions = {
  duration: { fast: '100ms', normal: '150ms', slow: '250ms' },
  easing:   'cubic-bezier(0.33, 0, 0.67, 1)',   // Fluent standard
} as const;

export const tokens = {
  fontFamily, fontSize, fontWeight, lineHeight, colors, spacing, radii, shadows, transitions,
} as const;

export default tokens;
