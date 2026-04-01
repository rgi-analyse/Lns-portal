'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';

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
}

const TemaCtx = createContext<TemaContext>({ organisasjonNavn: 'LNS' });

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

export function applyTheme(tema: Tema) {
  const root = document.documentElement;
  const { h, s, l } = hexToHSL(tema.primaryColor);

  root.style.setProperty('--gold', tema.primaryColor);
  root.style.setProperty('--gold-light', `hsl(${h}, ${s}%, ${Math.min(l + 10, 90)}%)`);
  root.style.setProperty('--gold-dim', `${tema.primaryColor}26`);
  root.style.setProperty('--glass-gold-bg', `${tema.primaryColor}1A`);
  root.style.setProperty('--glass-gold-border', `${tema.primaryColor}38`);
  root.style.setProperty('--text-gold', tema.primaryColor);
  root.style.setProperty('--ring', `${h} ${s}% ${l}%`);
  root.style.setProperty('--primary', `${h} ${s}% ${l}%`);
  root.style.setProperty('--navy-darkest', tema.backgroundColor);
  root.style.setProperty('--navy-dark', tema.navyColor);
  root.style.setProperty('--navy', tema.accentColor);
  root.style.setProperty('--navy-mid', tema.accentColor);
  document.body.style.setProperty('background', tema.backgroundColor);
  if (tema.textColor) {
    root.style.setProperty('--text-primary', tema.textColor);
  }
  if (tema.textMutedColor) {
    root.style.setProperty('--text-secondary', tema.textMutedColor);
    root.style.setProperty('--text-muted', tema.textMutedColor);
  }
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [organisasjonNavn, setOrganisasjonNavn] = useState('LNS');

  useEffect(() => {
    const hentTema = () => {
      apiFetch('/api/tema', { cache: 'no-store' })
        .then(res => res.ok ? res.json() as Promise<Tema> : null)
        .then(tema => {
          if (tema) {
            applyTheme(tema);
            setOrganisasjonNavn(tema.organisasjonNavn ?? 'LNS');
          }
        })
        .catch(() => { /* ikke kritisk — standard LNS-tema beholdes */ });
    };

    hentTema();

    const intervall = setInterval(hentTema, 30_000);
    return () => clearInterval(intervall);
  }, []);

  return (
    <TemaCtx.Provider value={{ organisasjonNavn }}>
      {children}
    </TemaCtx.Provider>
  );
}
