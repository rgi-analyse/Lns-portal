'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';
import { X } from 'lucide-react';

interface ViewInfo {
  id: string;
  schema_name: string;
  view_name: string;
  visningsnavn: string | null;
  prosjekt_kolonne: string | null;
  prosjekt_kolonne_type: string | null;
}

interface LagRapportModalProps {
  rapportId:        string;
  rapportNavn:      string;
  prosjektNr?:      string | null;
  authHeaders:      Record<string, string>;
  onLukk:           () => void;
  kontekstType?:    string | null;
  kontekstKolonne?: string | null;
  kontekstVerdi?:   string | null;
  kontekstLabel?:   string | null;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function LagRapportModal({
  rapportId,
  rapportNavn,
  prosjektNr,
  authHeaders,
  onLukk,
  kontekstType,
  kontekstKolonne,
  kontekstVerdi,
  kontekstLabel,
}: LagRapportModalProps) {
  const router = useRouter();
  const [views, setViews] = useState<ViewInfo[]>([]);
  const [valgtViewId, setValgtViewId] = useState<string>('');
  const [laster, setLaster] = useState(true);
  const [ingenViews, setIngenViews] = useState(false);
  const [navigerer, setNavigerer] = useState(false);
  const [fetchFeil, setFetchFeil] = useState(false);

  useEffect(() => {
    apiFetch(`/api/rapporter/${rapportId}/views`, {
      credentials: 'include',
      headers: authHeaders,
    })
      .then((r) => {
        console.log('[Modal] views API status:', r.status);
        return r.json() as Promise<unknown>;
      })
      .then((data) => {
        console.log('[Modal] views API respons (rå):', JSON.stringify(data));
        const liste: ViewInfo[] = (data as { views?: ViewInfo[] })?.views ?? [];
        console.log('[Modal] views array lengde:', liste.length);
        if (liste.length > 0) console.log('[Modal] første view:', JSON.stringify(liste[0]));
        setViews(liste);
        setIngenViews(liste.length === 0);
        if (liste.length >= 1) setValgtViewId(liste[0].id);
      })
      .catch((err) => {
        console.error('[Modal] fetch-feil:', err);
        setFetchFeil(true);
      })
      .finally(() => setLaster(false));
  }, [rapportId, authHeaders]);

  const valgtView = views.find((v) => v.id === valgtViewId);

  const brukView = () => {
    if (!valgtView || ingenViews) return;
    setNavigerer(true);

    const params = new URLSearchParams({
      viewNavn:     `${valgtView.schema_name}.${valgtView.view_name}`,
      visningsnavn: valgtView.visningsnavn ?? valgtView.view_name,
      fraRapportId: rapportId,
    });

    // Bakoverkompatibilitet: behold prosjektNr og view-kolonne hvis satt
    if (prosjektNr) {
      params.set('prosjektNr',          prosjektNr);
      if (valgtView.prosjekt_kolonne)      params.set('prosjektKolonne',     valgtView.prosjekt_kolonne);
      if (valgtView.prosjekt_kolonne_type) params.set('prosjektKolonneType', valgtView.prosjekt_kolonne_type);
    }

    // Ny kontekst-logikk: eksplisitte workspace-kontekst-felter
    if (kontekstKolonne && kontekstVerdi) {
      params.set('kontekstKolonne', kontekstKolonne);
      params.set('kontekstVerdi',   kontekstVerdi);
      params.set('kontekstType',    kontekstType    ?? 'prosjekt');
      params.set('kontekstLabel',   kontekstLabel   ?? kontekstVerdi);
      params.set('laast',           'true');
    }

    console.log('[Modal] sender params til rapport-designer/ny:', Object.fromEntries(params));
    router.push(`/dashboard/rapport-designer/ny?${params.toString()}`);
  };

  const erDeaktivert = !valgtView || ingenViews || fetchFeil || navigerer;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.60)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onLukk}
    >
      <div
        style={{
          width: 480, maxHeight: '80vh',
          background: 'rgba(16,22,36,0.98)',
          border: '1px solid var(--glass-border)',
          borderRadius: 14,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--glass-bg-hover)',
        }}>
          <div>
            <div style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 700, fontSize: 16,
              color: 'var(--text-primary)',
            }}>
              Lag rapport
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Basert på {rapportNavn}
            </div>
          </div>
          <button
            onClick={onLukk}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 4, borderRadius: 5,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {laster ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '32px 0' }}>
              Laster tilgjengelige datakilder…
            </div>
          ) : fetchFeil ? (
            <div style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 10, padding: 20,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <span style={{ fontWeight: 700, color: 'rgba(255,100,100,0.9)', fontSize: 14 }}>
                  Kunne ikke hente datakilder
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                Nettverksfeil ved henting av tilgjengelige views. Lukk og prøv igjen.
              </p>
            </div>
          ) : ingenViews ? (
            <div style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 10,
              padding: 20,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <span style={{ fontWeight: 700, color: 'rgba(255,100,100,0.9)', fontSize: 14 }}>
                  Ingen datakilder tilgjengelig
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                Denne rapporten er ikke koblet til noen datakilder i metadata-katalogen.
                Kontakt administrator for å koble et AI-view til rapporten før du kan opprette egne rapporter.
              </p>
              <div style={{
                marginTop: 12, padding: '8px 12px',
                background: 'var(--glass-bg)',
                borderRadius: 6, fontSize: 11,
                color: 'var(--text-muted)', fontFamily: 'monospace',
              }}>
                Admin → Metadata → Rapporter → Koble view
              </div>
            </div>
          ) : (
            <div>
              <div style={{
                fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--text-muted)',
                marginBottom: 10,
              }}>
                Velg datakilde
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {views.map((v) => (
                  <label
                    key={v.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${valgtViewId === v.id ? 'var(--gold-dim)' : 'var(--glass-bg-hover)'}`,
                      background: valgtViewId === v.id ? 'var(--gold-dim)' : 'var(--glass-bg)',
                    }}
                  >
                    <input
                      type="radio"
                      name="view"
                      value={v.id}
                      checked={valgtViewId === v.id}
                      onChange={() => setValgtViewId(v.id)}
                      style={{ accentColor: 'var(--gold)' }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                        {v.visningsnavn ?? v.view_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                        {v.schema_name}.{v.view_name}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 20px',
          borderTop: '1px solid var(--glass-bg-hover)',
        }}>
          <button
            onClick={onLukk}
            style={{
              padding: '7px 16px', fontSize: 13, borderRadius: 7,
              border: '1px solid var(--glass-border)',
              background: 'var(--glass-bg)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg)'; }}
          >
            Avbryt
          </button>
          <button
            onClick={brukView}
            disabled={erDeaktivert}
            style={{
              padding: '7px 16px', fontSize: 13, borderRadius: 7,
              border: 'none',
              background: erDeaktivert ? 'var(--glass-gold-border)' : 'var(--gold)',
              color: erDeaktivert ? 'var(--text-muted)' : '#1a1a1a',
              cursor: erDeaktivert ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            {fetchFeil
              ? 'Nettverksfeil'
              : ingenViews
              ? 'Ingen datakilder tilgjengelig'
              : navigerer
                ? 'Åpner designer…'
                : valgtView
                  ? `Bruk «${valgtView.visningsnavn ?? valgtView.view_name}»`
                  : 'Velg datakilde'}
          </button>
        </div>
      </div>
    </div>
  );
}
