'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function NyRapportForm() {
  const router  = useRouter();
  const params  = useSearchParams();

  // Alle prosjekt-parametre er skrivebeskyttet — satt av LagRapportModal, aldri av bruker
  const viewNavn            = params.get('viewNavn') ?? '';
  const visningsnavn        = params.get('visningsnavn') ?? viewNavn;
  const prosjektNr          = params.get('prosjektNr') ?? null;        // Låst fra kontekst
  const prosjektKolonne     = params.get('prosjektKolonne') ?? null;   // Låst fra view-metadata
  const prosjektKolonneType = params.get('prosjektKolonneType') ?? 'number';
  const fraRapportId        = params.get('fraRapportId') ?? null;

  const [tittel,      setTittel]      = useState('');
  const [beskrivelse, setBeskrivelse] = useState('');

  const kanStart = tittel.trim().length > 0 && viewNavn.length > 0;

  const start = () => {
    if (!kanStart) return;
    const qp = new URLSearchParams({
      viewNavn,
      visningsnavn,
      tittel: tittel.trim(),
      laast: 'true',
    });
    if (beskrivelse.trim())  qp.set('beskrivelse', beskrivelse.trim());
    if (prosjektKolonne)     qp.set('prosjektKolonne', prosjektKolonne);
    if (prosjektKolonneType) qp.set('prosjektKolonneType', prosjektKolonneType);
    if (fraRapportId)        qp.set('fraRapportId', fraRapportId);
    // prosjektNr videresendes umodifisert fra rapport-kontekst — aldri fra bruker-input
    if (prosjektNr)          qp.set('prosjektNr', prosjektNr);
    router.push(`/dashboard/rapport-interaktiv?${qp.toString()}`);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px', fontSize: 14,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, color: 'rgba(255,255,255,0.85)', outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700,
    letterSpacing: '0.12em', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.40)', marginBottom: 6,
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14, padding: 28,
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
            background: 'rgba(245,166,35,0.12)',
            border: '1px solid rgba(245,166,35,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20,
          }}>
            📊
          </div>
          <div>
            <h2 style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontSize: 22, fontWeight: 800,
              color: '#fff', textTransform: 'uppercase', margin: 0,
            }}>
              Ny rapport
            </h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '2px 0 0' }}>
              {visningsnavn}
            </p>
          </div>
        </div>

        {/* Låst kontekst-info — ikke redigerbar */}
        <div style={{
          background: 'rgba(245,166,35,0.06)',
          border: '1px solid rgba(245,166,35,0.15)',
          borderRadius: 8, padding: '10px 14px',
          marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <svg width="12" height="13" viewBox="0 0 12 13" fill="none" style={{ flexShrink: 0 }}>
            <rect x="1" y="6" width="10" height="7" rx="1.5" stroke="#F5A623" strokeWidth="1.2"/>
            <path d="M3.5 6V4a2.5 2.5 0 015 0v2" stroke="#F5A623" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            Data fra{' '}
            <strong style={{ color: '#F5A623' }}>{visningsnavn}</strong>
            {prosjektNr && (
              <> · Prosjekt <strong style={{ color: '#F5A623' }}>{prosjektNr}</strong></>
            )}
          </span>
        </div>

        {/* Tittel */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Tittel *</label>
          <input
            type="text"
            value={tittel}
            onChange={(e) => setTittel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
            placeholder="F.eks. Timeforbruk per fagområde"
            style={inputStyle}
            autoFocus
          />
        </div>

        {/* Beskrivelse */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Beskrivelse (valgfritt)</label>
          <textarea
            value={beskrivelse}
            onChange={(e) => setBeskrivelse(e.target.value)}
            placeholder="Hva skal rapporten vise?"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'Barlow, sans-serif' }}
          />
        </div>

        {/* Knapper */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => router.back()}
            style={{
              padding: '8px 18px', fontSize: 13, borderRadius: 7,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.65)', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; }}
          >
            Avbryt
          </button>
          <button
            onClick={start}
            disabled={!kanStart}
            style={{
              padding: '8px 20px', fontSize: 13, borderRadius: 7,
              border: 'none',
              background: kanStart ? '#F5A623' : 'rgba(245,166,35,0.25)',
              color: kanStart ? '#1a1a1a' : 'rgba(255,255,255,0.35)',
              cursor: kanStart ? 'pointer' : 'not-allowed',
              fontWeight: 700,
            }}
          >
            Start designer →
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NyRapportPage() {
  return (
    <Suspense>
      <NyRapportForm />
    </Suspense>
  );
}
