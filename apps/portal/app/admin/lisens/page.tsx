'use client';

import { useEffect, useState } from 'react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import type { Lisens } from '@/lib/lisens';

interface LisensAdmin extends Lisens {
  id:            string;
  slug:          string;
  navn:          string;
  antallBrukere: number;
  erAktiv:       boolean;
}

const LISENS_PAKKER = [
  { id: 'basis',    navn: 'Basis',    beskrivelse: 'Power BI-rapporter, maks 10 brukere',                      farge: 'var(--text-muted)' },
  { id: 'standard', navn: 'Standard', beskrivelse: 'Rapport-designer, AI-chat, eksport, maks 50 brukere',      farge: 'var(--gold)' },
  { id: 'premium',  navn: 'Premium',  beskrivelse: 'Alt i Standard + Personlig AI, ubegrenset brukere',        farge: 'rgba(110,231,183,0.9)' },
] as const;

const MODULER = [
  { key: 'chatAktivert',           label: 'AI-chat',                ikon: '💬' },
  { key: 'designerAktivert',       label: 'Rapport-designer',       ikon: '🎨' },
  { key: 'kombinertChartAktivert', label: 'Kombinert chart',        ikon: '📊' },
  { key: 'personalAiAktivert',     label: 'Personlig AI',           ikon: '🤖' },
  { key: 'eksportAktivert',        label: 'Eksport (CSV/Excel/PDF)', ikon: '📥' },
] as const;

export default function LisensPage() {
  const { entraObjectId, authHeaders } = usePortalAuth();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';

  const [lisens,  setLisens]  = useState<LisensAdmin | null>(null);
  const [lagrer,  setLagrer]  = useState(false);
  const [melding, setMelding] = useState<{ type: 'ok' | 'feil'; tekst: string } | null>(null);

  useEffect(() => {
    if (!entraObjectId) return;
    fetch(`${apiUrl}/api/admin/lisens`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : null)
      .then((data: LisensAdmin | null) => { if (data) setLisens(data); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entraObjectId]);

  async function lagre() {
    if (!lisens || !entraObjectId) return;
    setLagrer(true);
    setMelding(null);
    try {
      const res = await fetch(`${apiUrl}/api/admin/lisens`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          lisens:                 lisens.lisens,
          maxBrukere:             lisens.maxBrukere,
          lisensUtløper:          lisens.lisensUtløper,
          chatAktivert:           lisens.chatAktivert,
          designerAktivert:       lisens.designerAktivert,
          kombinertChartAktivert: lisens.kombinertChartAktivert,
          personalAiAktivert:     lisens.personalAiAktivert,
          eksportAktivert:        lisens.eksportAktivert,
        }),
      });
      if (!res.ok) throw new Error();
      const oppdatert: LisensAdmin = await res.json();
      setLisens(oppdatert);
      setMelding({ type: 'ok', tekst: 'Lisens oppdatert!' });
    } catch {
      setMelding({ type: 'feil', tekst: 'Kunne ikke lagre lisens.' });
    } finally {
      setLagrer(false);
    }
  }

  if (!lisens) return (
    <div className="p-8" style={{ color: 'var(--text-muted)' }}>Laster lisensinfo...</div>
  );

  const dagerIgjen = lisens.lisensUtløper
    ? Math.ceil((new Date(lisens.lisensUtløper).getTime() - Date.now()) / 86_400_000)
    : null;

  const utløperVerdi = dagerIgjen !== null
    ? lisens.erUtløpt ? '⚠️ Utløpt' : `${dagerIgjen} dager`
    : 'Ingen utløpsdato';

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 16px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        Lisens
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
        Administrer lisens og tilgjengelige moduler for {lisens.navn}.
      </p>

      {/* Status-kort */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Lisens',   verdi: lisens.lisens.charAt(0).toUpperCase() + lisens.lisens.slice(1) },
          { label: 'Brukere',  verdi: `${lisens.antallBrukere} / ${lisens.maxBrukere}` },
          { label: 'Utløper',  verdi: utløperVerdi },
        ].map(({ label, verdi }) => (
          <div key={label} style={{
            background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
            borderRadius: 10, padding: '12px 16px',
          }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)',
                        fontFamily: 'Barlow Condensed, sans-serif' }}>{verdi}</p>
          </div>
        ))}
      </div>

      {/* Lisens-pakke */}
      <div style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                    borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                    color: 'var(--text-muted)', marginBottom: 12 }}>LISENS-PAKKE</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {LISENS_PAKKER.map(p => (
            <button key={p.id} type="button"
              onClick={() => setLisens(l => l ? { ...l, lisens: p.id } : l)}
              style={{
                padding: 12, borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                border: lisens.lisens === p.id ? `2px solid ${p.farge}` : '1px solid var(--glass-border)',
                background: lisens.lisens === p.id ? `color-mix(in srgb, ${p.farge} 12%, transparent)` : 'var(--glass-bg)',
              }}>
              <p style={{ fontWeight: 700, fontSize: 14, color: p.farge, marginBottom: 4 }}>{p.navn}</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.beskrivelse}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Moduler */}
      <div style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                    borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                    color: 'var(--text-muted)', marginBottom: 12 }}>MODULER</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MODULER.map(({ key, label, ikon }) => (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderRadius: 8, background: 'var(--glass-bg-hover)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>{ikon}</span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
              </div>
              <button type="button"
                onClick={() => setLisens(l => l ? { ...l, [key]: !l[key] } : l)}
                style={{
                  width: 40, height: 22, borderRadius: 11, border: 'none',
                  cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                  background: lisens[key] ? 'var(--gold)' : 'var(--glass-border)', flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute', top: 3,
                  left: lisens[key] ? 20 : 3,
                  width: 16, height: 16, borderRadius: '50%',
                  background: 'white', transition: 'left 0.2s',
                }} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Detaljer */}
      <div style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                    borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                    color: 'var(--text-muted)', marginBottom: 12 }}>DETALJER</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
              Maks brukere
            </label>
            <input type="number" min={1} value={lisens.maxBrukere}
              onChange={e => setLisens(l => l ? { ...l, maxBrukere: parseInt(e.target.value) || 1 } : l)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 13,
                       background: 'var(--glass-bg-hover)', border: '1px solid var(--glass-border)',
                       color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
              Lisens utløper (valgfritt)
            </label>
            <input type="date"
              value={lisens.lisensUtløper
                ? new Date(lisens.lisensUtløper).toISOString().split('T')[0] : ''}
              onChange={e => setLisens(l => l ? { ...l, lisensUtløper: e.target.value || null } : l)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 13,
                       background: 'var(--glass-bg-hover)', border: '1px solid var(--glass-border)',
                       color: 'var(--text-primary)' }} />
          </div>
        </div>
      </div>

      {/* Melding */}
      {melding && (
        <div style={{
          borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13,
          background: melding.type === 'ok' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          border: `1px solid ${melding.type === 'ok' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
          color: melding.type === 'ok' ? 'rgb(134,239,172)' : 'rgb(252,165,165)',
        }}>
          {melding.tekst}
        </div>
      )}

      <button type="button" onClick={lagre} disabled={lagrer} style={{
        padding: '10px 24px', borderRadius: 8, cursor: lagrer ? 'not-allowed' : 'pointer',
        background: 'var(--glass-gold-bg)', border: '1px solid var(--glass-gold-border)',
        color: 'var(--gold)', fontSize: 13, fontWeight: 600, opacity: lagrer ? 0.6 : 1,
      }}>
        {lagrer ? 'Lagrer...' : 'Lagre lisens'}
      </button>
    </div>
  );
}
