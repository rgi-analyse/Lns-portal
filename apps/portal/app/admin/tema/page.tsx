'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';

interface Tema {
  id?: string;
  organisasjonNavn: string;
  primaryColor: string;
  backgroundColor: string;
  navyColor: string;
  accentColor: string;
  logoUrl?: string | null;
}

const STANDARD_TEMA: Tema = {
  organisasjonNavn: 'LNS',
  primaryColor: '#F5A623',
  backgroundColor: '#0a1628',
  navyColor: '#1B2A4A',
  accentColor: '#243556',
  logoUrl: null,
};

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border-0 p-0 shrink-0"
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 rounded px-3 py-1.5 text-sm font-mono"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.88)',
          }}
        />
      </div>
    </div>
  );
}

export default function TemaAdminPage() {
  const { accounts } = useMsal();
  const entraId = accounts[0]?.localAccountId ?? '';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';

  const [tema, setTema] = useState<Tema>(STANDARD_TEMA);
  const [lagrer, setLagrer] = useState(false);
  const [melding, setMelding] = useState<{ type: 'ok' | 'feil'; tekst: string } | null>(null);

  const lastTema = useCallback(async () => {
    const res = await fetch(`${apiUrl}/api/admin/tema`, {
      headers: { 'x-entra-object-id': entraId },
    });
    if (res.ok) {
      const temaer = await res.json() as Tema[];
      if (temaer.length > 0) setTema(temaer[0]);
    }
  }, [apiUrl, entraId]);

  useEffect(() => { lastTema(); }, [lastTema]);

  // Live forhåndsvisning
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--gold', tema.primaryColor);
    root.style.setProperty('--text-gold', tema.primaryColor);
    root.style.setProperty('--navy-darkest', tema.backgroundColor);
    root.style.setProperty('--navy-dark', tema.navyColor);
    root.style.setProperty('--navy', tema.accentColor);
    document.body.style.setProperty('background', tema.backgroundColor);
  }, [tema]);

  async function lagreTema() {
    setLagrer(true);
    setMelding(null);
    try {
      const method = tema.id ? 'PATCH' : 'POST';
      const url = tema.id ? `${apiUrl}/api/admin/tema/${tema.id}` : `${apiUrl}/api/admin/tema`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-entra-object-id': entraId },
        body: JSON.stringify(tema),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? 'Ukjent feil');
      }
      const oppdatert = await res.json() as Tema;
      setTema(oppdatert);
      setMelding({ type: 'ok', tekst: 'Tema lagret!' });
    } catch (err: unknown) {
      setMelding({ type: 'feil', tekst: err instanceof Error ? err.message : 'Ukjent feil' });
    } finally {
      setLagrer(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.92)' }}>Tema</h1>
      <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.50)' }}>
        Tilpass farger og utseende. Endringer vises live og lagres for alle brukere.
      </p>

      <div className="rounded-xl p-6 mb-6 flex flex-col gap-5"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>

        {/* Organisasjonsnavn */}
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>Organisasjonsnavn</label>
          <input
            type="text"
            value={tema.organisasjonNavn}
            onChange={e => setTema(t => ({ ...t, organisasjonNavn: e.target.value }))}
            className="rounded px-3 py-1.5 text-sm"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.88)' }}
          />
        </div>

        {/* Farger */}
        <div className="grid grid-cols-2 gap-4">
          <ColorField label="Primærfarge (knapper, aksenter)" value={tema.primaryColor} onChange={v => setTema(t => ({ ...t, primaryColor: v }))} />
          <ColorField label="Bakgrunnsfarge" value={tema.backgroundColor} onChange={v => setTema(t => ({ ...t, backgroundColor: v }))} />
          <ColorField label="Navigasjonsfarge" value={tema.navyColor} onChange={v => setTema(t => ({ ...t, navyColor: v }))} />
          <ColorField label="Aksentfarge" value={tema.accentColor} onChange={v => setTema(t => ({ ...t, accentColor: v }))} />
        </div>

        {/* Logo-URL */}
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>Logo-URL (valgfritt)</label>
          <input
            type="text"
            value={tema.logoUrl ?? ''}
            placeholder="https://eksempel.no/logo.svg"
            onChange={e => setTema(t => ({ ...t, logoUrl: e.target.value || null }))}
            className="rounded px-3 py-1.5 text-sm"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.88)' }}
          />
        </div>
      </div>

      {/* Forhåndsvisning */}
      <div className="rounded-xl p-5 mb-6" style={{ background: tema.navyColor, border: `1px solid ${tema.primaryColor}33` }}>
        <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.40)' }}>Forhåndsvisning</p>
        <div className="flex items-center justify-between px-4 py-3 rounded-lg" style={{ background: tema.backgroundColor }}>
          <span className="font-semibold text-sm" style={{ color: '#fff' }}>{tema.organisasjonNavn} Dataportal</span>
          <span className="text-xs font-medium px-3 py-1 rounded" style={{ background: tema.primaryColor, color: tema.backgroundColor }}>
            Ny rapport
          </span>
        </div>
      </div>

      {melding && (
        <div className="rounded-lg px-4 py-3 mb-4 text-sm" style={{
          background: melding.type === 'ok' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          border: `1px solid ${melding.type === 'ok' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
          color: melding.type === 'ok' ? 'rgb(134,239,172)' : 'rgb(252,165,165)',
        }}>
          {melding.tekst}
        </div>
      )}

      <button
        onClick={lagreTema}
        disabled={lagrer}
        className="rounded-lg px-6 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
        style={{ background: `${tema.primaryColor}1A`, border: `1px solid ${tema.primaryColor}38`, color: tema.primaryColor }}
      >
        {lagrer ? 'Lagrer...' : 'Lagre tema'}
      </button>
    </div>
  );
}
