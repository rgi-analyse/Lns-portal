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
  rapportId: string;
  rapportNavn: string;
  prosjektNr?: string | null;   // Arvet fra rapport-kontekst — aldri fra bruker
  authHeaders: Record<string, string>;
  onLukk: () => void;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function LagRapportModal({
  rapportId,
  rapportNavn,
  prosjektNr,
  authHeaders,
  onLukk,
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
    console.log('[Modal] sender params:', {
      viewNavn: `${valgtView.schema_name}.${valgtView.view_name}`,
      prosjektNr: prosjektNr ?? '(null — workspace-navn mangler tall)',
      prosjektKolonne: valgtView.prosjekt_kolonne,
    });
    const params = new URLSearchParams({
      viewNavn:    `${valgtView.schema_name}.${valgtView.view_name}`,
      visningsnavn: valgtView.visningsnavn ?? valgtView.view_name,
      fraRapportId: rapportId,
      laast:        'true',
    });
    if (valgtView.prosjekt_kolonne)      params.set('prosjektKolonne',     valgtView.prosjekt_kolonne);
    if (valgtView.prosjekt_kolonne_type) params.set('prosjektKolonneType', valgtView.prosjekt_kolonne_type);
    // prosjektNr er ALLTID fra rapport-kontekst, aldri fra bruker-input
    if (prosjektNr)                      params.set('prosjektNr',          prosjektNr);
    console.log('[Modal] full URL:', `/dashboard/rapport-designer/ny?${params.toString()}`);
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
          border: '1px solid rgba(255,255,255,0.10)',
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
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div>
            <div style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 700, fontSize: 16,
              color: 'rgba(255,255,255,0.9)',
            }}>
              Lag rapport
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
              Basert på {rapportNavn}
            </div>
          </div>
          <button
            onClick={onLukk}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.45)', padding: 4, borderRadius: 5,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.85)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.45)'; }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {laster ? (
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, textAlign: 'center', padding: '32px 0' }}>
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
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, margin: 0 }}>
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
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, margin: 0 }}>
                Denne rapporten er ikke koblet til noen datakilder i metadata-katalogen.
                Kontakt administrator for å koble et AI-view til rapporten før du kan opprette egne rapporter.
              </p>
              <div style={{
                marginTop: 12, padding: '8px 12px',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 6, fontSize: 11,
                color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace',
              }}>
                Admin → Metadata → Rapporter → Koble view
              </div>
            </div>
          ) : (
            <div>
              <div style={{
                fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'rgba(255,255,255,0.40)',
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
                      border: `1px solid ${valgtViewId === v.id ? 'rgba(245,166,35,0.40)' : 'rgba(255,255,255,0.07)'}`,
                      background: valgtViewId === v.id ? 'rgba(245,166,35,0.06)' : 'rgba(255,255,255,0.02)',
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
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>
                        {v.visningsnavn ?? v.view_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>
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
          borderTop: '1px solid rgba(255,255,255,0.07)',
        }}>
          <button
            onClick={onLukk}
            style={{
              padding: '7px 16px', fontSize: 13, borderRadius: 7,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.65)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; }}
          >
            Avbryt
          </button>
          <button
            onClick={brukView}
            disabled={erDeaktivert}
            style={{
              padding: '7px 16px', fontSize: 13, borderRadius: 7,
              border: 'none',
              background: erDeaktivert ? 'rgba(245,166,35,0.25)' : 'var(--gold)',
              color: erDeaktivert ? 'rgba(255,255,255,0.35)' : '#1a1a1a',
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
