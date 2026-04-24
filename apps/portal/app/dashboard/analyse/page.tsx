'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, TrendingUp, Loader2 } from 'lucide-react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';
import { AnalyseIkon } from '@/components/analyse/AnalyseIkon';

interface Bestilling {
  id:             string;
  analyseTypeId:  string;
  tittel:         string | null;
  status:         string;
  bestiltDato:    string;
  analyseType: {
    id:   string;
    navn: string;
    ikon: string | null;
  };
}

function formaterDato(iso: string): string {
  const dato = new Date(iso);
  if (isNaN(dato.getTime())) return '—';
  return dato.toLocaleDateString('nb-NO', {
    day:      'numeric',
    month:    'short',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
    timeZone: 'Europe/Oslo',
  });
}

function StatusBadge({ status }: { status: string }) {
  const stil = statusStil(status);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={stil.style}
    >
      {status === 'KJORER' && <Loader2 className="w-3 h-3 animate-spin" />}
      {stil.label}
    </span>
  );
}

function statusStil(status: string): { label: string; style: React.CSSProperties } {
  switch (status) {
    case 'BESTILT':
      return {
        label: 'Bestilt',
        style: { background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)', color: 'rgb(147,197,253)' },
      };
    case 'KJORER':
      return {
        label: 'Kjører',
        style: { background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: 'rgb(252,211,77)' },
      };
    case 'FERDIG':
      return {
        label: 'Ferdig',
        style: { background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: 'rgb(110,231,183)' },
      };
    case 'FEILET':
      return {
        label: 'Feilet',
        style: { background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: 'rgb(252,165,165)' },
      };
    case 'KANSELLERT':
      return {
        label: 'Kansellert',
        style: { background: 'var(--glass-bg)', border: '1px solid var(--glass-bg-hover)', color: 'var(--text-muted)', opacity: 0.75 },
      };
    default:
      return {
        label: status,
        style: { background: 'var(--glass-bg)', border: '1px solid var(--glass-bg-hover)', color: 'var(--text-muted)' },
      };
  }
}

export default function AnalyseListePage() {
  const router = useRouter();
  const { isAuthenticated, entraObjectId, authHeaders } = usePortalAuth();
  const [bestillinger, setBestillinger] = useState<Bestilling[] | null>(null);
  const [feilmelding, setFeilmelding]   = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !entraObjectId) return;
    apiFetch('/api/analyse/bestillinger', { headers: authHeaders, cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 403) {
          setFeilmelding('Du har ikke tilgang til analyse-modulen.');
          setBestillinger([]);
          return;
        }
        if (!r.ok) throw new Error('Kunne ikke hente bestillinger');
        const data: Bestilling[] = await r.json();
        setBestillinger(data);
      })
      .catch(() => {
        setFeilmelding('Kunne ikke laste bestillingene dine.');
        setBestillinger([]);
      });
  }, [isAuthenticated, entraObjectId, authHeaders]);

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1
              className="uppercase tracking-wide"
              style={{
                fontFamily:   'Barlow Condensed, sans-serif',
                fontWeight:   800,
                fontSize:     28,
                color:        'var(--text-primary)',
                letterSpacing: '0.03em',
              }}
            >
              Mine analyser
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              Bestill dyptgående analyser og last ned rapporter.
            </p>
          </div>
          <button
            onClick={() => router.push('/dashboard/analyse/ny')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{
              background: 'var(--glass-gold-bg)',
              border:     '1px solid var(--glass-gold-border)',
              color:      'var(--gold)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gold-dim)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-gold-bg)'; }}
          >
            <Plus className="w-4 h-4" />
            Bestill ny analyse
          </button>
        </div>

        {/* Feilmelding */}
        {feilmelding && (
          <div
            className="mb-6 rounded-lg px-4 py-3 text-sm"
            style={{
              background: 'rgba(239,68,68,0.10)',
              border:     '1px solid rgba(239,68,68,0.30)',
              color:      'rgb(252,165,165)',
            }}
          >
            {feilmelding}
          </div>
        )}

        {/* Liste */}
        {bestillinger === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse"
                style={{
                  height:     64,
                  background: 'var(--glass-bg)',
                  border:     '1px solid var(--glass-bg)',
                  borderRadius: 12,
                }}
              />
            ))}
          </div>
        ) : bestillinger.length === 0 && !feilmelding ? (
          <div
            className="text-center py-16 rounded-xl"
            style={{
              background: 'var(--glass-bg)',
              border:     '1px dashed var(--glass-bg-hover)',
            }}
          >
            <TrendingUp className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Du har ingen analyser ennå.
            </p>
            <button
              onClick={() => router.push('/dashboard/analyse/ny')}
              className="mt-4 text-sm font-semibold underline"
              style={{ color: 'var(--gold)' }}
            >
              Bestill din første
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {bestillinger.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => router.push(`/dashboard/analyse/${b.id}`)}
                className="w-full flex items-center gap-4 text-left transition-all"
                style={{
                  background:   'var(--glass-bg)',
                  border:       '1px solid var(--glass-bg-hover)',
                  borderRadius: 12,
                  padding:      '14px 18px',
                  cursor:       'pointer',
                  opacity:      b.status === 'KANSELLERT' ? 0.65 : 1,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-gold-border)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-bg-hover)'; }}
              >
                {/* Ikon */}
                <div
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width:        40,
                    height:       40,
                    background:   'var(--glass-gold-bg)',
                    border:       '1px solid var(--glass-gold-border)',
                    borderRadius: 10,
                    color:        'var(--gold)',
                  }}
                >
                  <AnalyseIkon navn={b.analyseType.ikon} className="w-5 h-5" />
                </div>

                {/* Midt */}
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                    {b.tittel || b.analyseType.navn}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>{b.analyseType.navn}</span>
                    <span>·</span>
                    <span>{formaterDato(b.bestiltDato)}</span>
                  </div>
                </div>

                {/* Status */}
                <div className="shrink-0">
                  <StatusBadge status={b.status} />
                </div>

                {/* Pil */}
                <div style={{ color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
                  ›
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
