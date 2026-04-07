'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';

interface View {
  viewNavn:     string;
  visningsnavn: string;
}

interface Workspace {
  id:               string;
  navn:             string;
  kontekstType?:    string | null;
  kontekstKolonne?: string | null;
  kontekstVerdi?:   string | null;
  kontekstLabel?:   string | null;
}

interface Props {
  workspace:   Workspace;
  authHeaders: Record<string, string>;
  onLukk:      () => void;
}

const KONTEKST_LABEL: Record<string, string> = {
  prosjekt:    'Prosjekt',
  avdeling:    'Avdeling',
  kunde:       'Kunde',
  leverandor:  'Leverandør',
};

export default function NyRapportModal({ workspace, authHeaders, onLukk }: Props) {
  const router = useRouter();
  const [views,       setViews]       = useState<View[]>([]);
  const [laster,      setLaster]      = useState(true);
  const [valgtView,   setValgtView]   = useState('');
  const [tittel,      setTittel]      = useState('');
  const [manueltView, setManueltView] = useState('');
  const [visManuelt,  setVisManuelt]  = useState(false);

  useEffect(() => {
    apiFetch(`/api/workspaces/${workspace.id}/views`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : [])
      .then((data: View[]) => {
        setViews(data);
        if (data.length === 0) setVisManuelt(true);
        setLaster(false);
      })
      .catch(() => { setVisManuelt(true); setLaster(false); });
  }, [workspace.id, authHeaders]);

  function startDesigner() {
    const view = visManuelt ? manueltView.trim() : valgtView;
    if (!view || !tittel.trim()) return;

    const visningsnavn = views.find(v => v.viewNavn === view)?.visningsnavn ?? view;

    const params = new URLSearchParams({
      viewNavn:     view,
      visningsnavn,
      tittel:       tittel.trim(),
      laast:        'true',
    });

    if (workspace.kontekstKolonne && workspace.kontekstVerdi) {
      params.set('kontekstType',    workspace.kontekstType    ?? 'prosjekt');
      params.set('kontekstKolonne', workspace.kontekstKolonne);
      params.set('kontekstVerdi',   workspace.kontekstVerdi);
      params.set('kontekstLabel',   workspace.kontekstLabel   ?? workspace.kontekstVerdi);
      // Map til prosjektNr/prosjektKolonne for rapport-interaktiv
      params.set('prosjektNr',          workspace.kontekstVerdi);
      params.set('prosjektKolonne',     workspace.kontekstKolonne);
      params.set('prosjektKolonneType', workspace.kontekstType === 'string' ? 'string' : 'number');
    }

    router.push(`/dashboard/rapport-interaktiv?${params.toString()}`);
  }

  const aktiveView = visManuelt ? manueltView.trim() : valgtView;
  const kanStarte  = !!aktiveView && !!tittel.trim();

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
    color: 'var(--text-primary)', fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    color: 'var(--text-muted)', display: 'block', marginBottom: 6,
    textTransform: 'uppercase',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onLukk}
    >
      <div
        style={{
          background: 'rgba(10,22,40,0.98)',
          border: '1px solid var(--glass-border)',
          borderRadius: 16,
          padding: '28px 32px',
          width: '100%', maxWidth: 480,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: 'var(--glass-gold-bg)',
            border: '1px solid var(--glass-gold-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>
            📊
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Ny rapport
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              {workspace.navn}
            </p>
          </div>
        </div>

        {/* Kontekst-info */}
        {workspace.kontekstKolonne && workspace.kontekstVerdi && (
          <div style={{
            background: 'var(--glass-gold-bg)',
            border: '1px solid var(--glass-gold-border)',
            borderRadius: 8, padding: '8px 12px', marginBottom: 16,
            fontSize: 12, color: 'var(--gold)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <svg width="11" height="13" viewBox="0 0 12 13" fill="none" style={{ flexShrink: 0 }}>
              <rect x="1" y="6" width="10" height="7" rx="1.5" stroke="var(--gold)" strokeWidth="1.2"/>
              <path d="M3.5 6V4a2.5 2.5 0 015 0v2" stroke="var(--gold)" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span style={{ color: 'var(--text-secondary)' }}>
              {KONTEKST_LABEL[workspace.kontekstType ?? ''] ?? 'Kontekst'}
              {': '}
              <strong style={{ color: 'var(--gold)' }}>
                {workspace.kontekstLabel ?? workspace.kontekstVerdi}
              </strong>
            </span>
          </div>
        )}

        {/* View-velger */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Datakilde</label>

          {laster ? (
            <div style={{
              height: 38, borderRadius: 8,
              background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
            }} />
          ) : views.length > 0 ? (
            <>
              <select
                value={visManuelt ? '__manuelt__' : valgtView}
                onChange={e => {
                  if (e.target.value === '__manuelt__') {
                    setVisManuelt(true);
                    setValgtView('');
                  } else {
                    setVisManuelt(false);
                    setValgtView(e.target.value);
                  }
                }}
                style={inputStyle}
              >
                <option value="">— Velg datakilde —</option>
                {views.map(v => (
                  <option key={v.viewNavn} value={v.viewNavn}>
                    {v.visningsnavn}
                  </option>
                ))}
                <option value="__manuelt__">✏️ Skriv inn manuelt...</option>
              </select>

              {visManuelt && (
                <input
                  type="text"
                  placeholder="f.eks. ai_gold.vw_Fact_RUH"
                  value={manueltView}
                  onChange={e => setManueltView(e.target.value)}
                  style={{ ...inputStyle, marginTop: 8 }}
                />
              )}
            </>
          ) : (
            <input
              type="text"
              placeholder="f.eks. ai_gold.vw_Fact_RUH"
              value={manueltView}
              onChange={e => setManueltView(e.target.value)}
              style={inputStyle}
            />
          )}
        </div>

        {/* Tittel */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Tittel *</label>
          <input
            type="text"
            placeholder="F.eks. Timeforbruk per fagområde"
            value={tittel}
            onChange={e => setTittel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && kanStarte) startDesigner(); }}
            autoFocus
            style={inputStyle}
          />
        </div>

        {/* Knapper */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onLukk}
            style={{
              padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
              background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
              color: 'var(--text-secondary)', fontSize: 13,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg)'; }}
          >
            Avbryt
          </button>
          <button
            onClick={startDesigner}
            disabled={!kanStarte}
            style={{
              padding: '8px 20px', borderRadius: 8,
              cursor: kanStarte ? 'pointer' : 'not-allowed',
              background: kanStarte ? 'var(--glass-gold-bg)' : 'var(--glass-bg)',
              border: `1px solid ${kanStarte ? 'var(--glass-gold-border)' : 'var(--glass-border)'}`,
              color: kanStarte ? 'var(--gold)' : 'var(--text-muted)',
              fontSize: 13, fontWeight: 600,
              opacity: kanStarte ? 1 : 0.5,
            }}
          >
            Start designer →
          </button>
        </div>
      </div>
    </div>
  );
}
