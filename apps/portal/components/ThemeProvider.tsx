'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch, getTenantSlug } from '@/lib/apiClient';

// localStorage-nøkkel for cachet tema per tenant. Inline-scriptet i layout.tsx
// må bruke nøyaktig samme prefiks.
export const TEMA_CACHE_PREFIX = 'tema:';

interface Tema {
  primaryColor: string;
  backgroundColor: string;
  navyColor: string;
  accentColor: string;
  textColor?: string;
  textMutedColor?: string;
  logoUrl?: string | null;
  organisasjonNavn?: string;
}

interface TemaContext {
  organisasjonNavn: string;
  logoUrl: string | null;
}

const TemaCtx = createContext<TemaContext>({ organisasjonNavn: 'LNS', logoUrl: null });

export function useTema() {
  return useContext(TemaCtx);
}

function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// Bygger CSS-variabel-mappen fra et tema. Holdt ren (ingen DOM-tilgang) slik at
// samme mapping kan caches i localStorage og gjenbrukes av inline-scriptet i
// <head> (se applyCachedTheme / layout.tsx) for å unngå tema-flash før paint.
export function computeThemeVars(tema: Tema): Record<string, string> {
  const { h, s, l } = hexToHSL(tema.primaryColor);
  const vars: Record<string, string> = {
    '--gold':              tema.primaryColor,
    '--gold-light':        `hsl(${h}, ${s}%, ${Math.min(l + 10, 90)}%)`,
    '--gold-dim':          `${tema.primaryColor}26`,
    '--glass-gold-bg':     `${tema.primaryColor}1A`,
    '--glass-gold-border': `${tema.primaryColor}38`,
    '--text-gold':         tema.primaryColor,
    '--ring':              `${h} ${s}% ${l}%`,
    '--primary':           `${h} ${s}% ${l}%`,
    '--navy-darkest':      tema.backgroundColor,
    '--navy-dark':         tema.navyColor,
    '--navy':              tema.accentColor,
    '--navy-mid':          tema.accentColor,
  };
  if (tema.textColor) {
    vars['--text-primary'] = tema.textColor;
  }
  if (tema.textMutedColor) {
    vars['--text-secondary'] = tema.textMutedColor;
    vars['--text-muted']     = tema.textMutedColor;
  }
  return vars;
}

export function applyTheme(tema: Tema): Record<string, string> {
  const root = document.documentElement;
  const vars = computeThemeVars(tema);
  for (const [navn, verdi] of Object.entries(vars)) {
    root.style.setProperty(navn, verdi);
  }
  // body-bakgrunn drives nå av var(--navy-darkest) (globals.css), så --navy-darkest
  // over dekker den. Setter også eksplisitt for å overstyre evt. tidligere inline-verdi.
  document.body.style.setProperty('background', tema.backgroundColor);
  return vars;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [organisasjonNavn, setOrganisasjonNavn] = useState('LNS');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    const hentTema = () => {
      apiFetch('/api/tema', { cache: 'no-store' })
        .then(res => res.ok ? res.json() as Promise<Tema> : null)
        .then(tema => {
          if (tema) {
            const vars = applyTheme(tema);
            // Cache mappen for denne tenanten slik at neste refresh kan settes
            // synkront før paint av inline-scriptet (eliminerer tema-flash).
            try {
              localStorage.setItem(
                TEMA_CACHE_PREFIX + getTenantSlug(),
                JSON.stringify({ vars, bodyBg: tema.backgroundColor }),
              );
            } catch { /* localStorage utilgjengelig (privat modus o.l.) — ikke kritisk */ }
            const navn = tema.organisasjonNavn ?? 'LNS';
            setOrganisasjonNavn(navn);
            setLogoUrl(tema.logoUrl ?? null);
            // Tenant-bevisst fane-tittel. Settes imperativt her (samme mønster som
            // applyTheme) i stedet for via useEffect på default-staten — ellers ville
            // mount skrevet "LNS Dataportal" og gjeninnført LNS-flash på demo. Den
            // nøytrale metadata-fallbacken ("Dataportal") vises til ekte tema ankommer.
            document.title = `${navn} Dataportal`;
          }
        })
        .catch(() => { /* ikke kritisk — standard LNS-tema beholdes */ });
    };

    hentTema();

    const intervall = setInterval(hentTema, 30_000);
    return () => clearInterval(intervall);
  }, []);

  return (
    <TemaCtx.Provider value={{ organisasjonNavn, logoUrl }}>
      {children}
    </TemaCtx.Provider>
  );
}
