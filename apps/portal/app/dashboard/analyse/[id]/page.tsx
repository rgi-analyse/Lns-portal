'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Download, Loader2, TrendingUp, XCircle, AlertTriangle } from 'lucide-react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';

interface Bestilling {
  id:             string;
  brukerId:       string;
  tenantSlug:     string;
  analyseTypeId:  string;
  parametre:      Record<string, unknown> | null;
  status:         string;
  bestiltDato:    string;
  startetDato:    string | null;
  ferdigDato:     string | null;
  tittel:         string | null;
  sammendrag:     string | null;
  dokumentUrl:    string | null;
  dokumentNavn:   string | null;
  feilmelding:    string | null;
  forsokAntall:   number;
  tokenForbruk:   number | null;
  modellBrukt:    string | null;
  analyseType: {
    id:          string;
    navn:        string;
    ikon:        string | null;
    beskrivelse: string | null;
  };
}

function formaterDato(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('nb-NO', {
    day:      'numeric',
    month:    'long',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
    timeZone: 'Europe/Oslo',
  });
}

function formaterParameter(verdi: unknown): string {
  if (verdi === null || verdi === undefined) return '—';
  if (typeof verdi === 'boolean') return verdi ? 'Ja' : 'Nei';
  if (typeof verdi === 'object') return JSON.stringify(verdi);
  return String(verdi);
}

function statusLabel(status: string): string {
  switch (status) {
    case 'BESTILT':    return 'Bestilt';
    case 'KJORER':     return 'Kjører';
    case 'FERDIG':     return 'Ferdig';
    case 'FEILET':     return 'Feilet';
    case 'KANSELLERT': return 'Kansellert';
    default:           return status;
  }
}

function statusFarge(status: string): React.CSSProperties {
  switch (status) {
    case 'BESTILT':
      return { background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)', color: 'rgb(147,197,253)' };
    case 'KJORER':
      return { background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: 'rgb(252,211,77)' };
    case 'FERDIG':
      return { background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: 'rgb(110,231,183)' };
    case 'FEILET':
      return { background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: 'rgb(252,165,165)' };
    default:
      return { background: 'var(--glass-bg)', border: '1px solid var(--glass-bg-hover)', color: 'var(--text-muted)' };
  }
}

export default function AnalyseDetaljPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { isAuthenticated, entraObjectId, authHeaders } = usePortalAuth();

  const [bestilling, setBestilling] = useState<Bestilling | null>(null);
  const [lasteStatus, setLasteStatus] = useState<'loading' | 'ok' | 'notfound' | 'forbidden' | 'error'>('loading');
  const [kansellerer, setKansellerer] = useState(false);
  const [kansellerFeil, setKansellerFeil] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !entraObjectId || !id) return;
    apiFetch(`/api/analyse/bestillinger/${id}`, { headers: authHeaders, cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 404) { setLasteStatus('notfound'); return; }
        if (r.status === 403) { setLasteStatus('forbidden'); return; }
        if (!r.ok) { setLasteStatus('error'); return; }
        const data: Bestilling = await r.json();
        setBestilling(data);
        setLasteStatus('ok');
      })
      .catch(() => setLasteStatus('error'));
  }, [isAuthenticated, entraObjectId, authHeaders, id]);

  async function kanseller() {
    if (!bestilling) return;
    setKansellerFeil(null);
    setKansellerer(true);
    try {
      const r = await apiFetch(`/api/analyse/bestillinger/${bestilling.id}`, {
        method:  'DELETE',
        headers: authHeaders,
      });
      if (!r.ok) {
        const detail = await r.json().catch(() => ({}));
        throw new Error(detail?.error ?? 'Kunne ikke kansellere bestillingen.');
      }
      const oppdatert: Bestilling = await r.json();
      setBestilling(oppdatert);
    } catch (err) {
      setKansellerFeil(err instanceof Error ? err.message : 'Ukjent feil');
    } finally {
      setKansellerer(false);
    }
  }

  // ── Tilstand: laster ──
  if (lasteStatus === 'loading') {
    return (
      <div className="h-full overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                height:       i === 0 ? 120 : 64,
                background:   'var(--glass-bg)',
                border:       '1px solid var(--glass-bg)',
                borderRadius: 12,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Tilstand: feil ──
  if (lasteStatus !== 'ok' || !bestilling) {
    const melding =
      lasteStatus === 'notfound'  ? 'Bestillingen finnes ikke, eller tilhører en annen bruker.' :
      lasteStatus === 'forbidden' ? 'Du har ikke tilgang til analyse-modulen.' :
                                    'Kunne ikke laste bestillingen.';
    return (
      <div className="h-full overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => router.push('/dashboard/analyse')}
            className="flex items-center gap-1.5 text-sm mb-6 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronLeft className="w-4 h-4" />
            Tilbake til mine analyser
          </button>
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{
              background: 'rgba(239,68,68,0.10)',
              border:     '1px solid rgba(239,68,68,0.30)',
              color:      'rgb(252,165,165)',
            }}
          >
            {melding}
          </div>
        </div>
      </div>
    );
  }

  // ── Tilstand: lastet ──
  const parametre = bestilling.parametre ?? {};
  const parameterKeys = Object.keys(parametre);

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">

        {/* Tilbake */}
        <button
          onClick={() => router.push('/dashboard/analyse')}
          className="flex items-center gap-1.5 text-sm mb-6 transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}
        >
          <ChevronLeft className="w-4 h-4" />
          Tilbake til mine analyser
        </button>

        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div
            className="flex items-center justify-center shrink-0"
            style={{
              width:        56,
              height:       56,
              background:   'var(--glass-gold-bg)',
              border:       '1px solid var(--glass-gold-border)',
              borderRadius: 12,
              color:        'var(--gold)',
              fontSize:     24,
            }}
          >
            {bestilling.analyseType.ikon ?? <TrendingUp className="w-7 h-7" />}
          </div>
          <div className="flex-1 min-w-0">
            <h1
              className="uppercase tracking-wide truncate"
              style={{
                fontFamily:    'Barlow Condensed, sans-serif',
                fontWeight:    800,
                fontSize:      26,
                color:         'var(--text-primary)',
                letterSpacing: '0.03em',
              }}
            >
              {bestilling.tittel || bestilling.analyseType.navn}
            </h1>
            <div className="mt-1.5 flex items-center gap-2.5 flex-wrap">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={statusFarge(bestilling.status)}
              >
                {bestilling.status === 'KJORER' && <Loader2 className="w-3 h-3 animate-spin" />}
                {statusLabel(bestilling.status)}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {bestilling.analyseType.navn}
              </span>
            </div>
          </div>
        </div>

        {/* Tilstandskort — KJORER */}
        {bestilling.status === 'KJORER' && (
          <div
            className="flex items-center gap-3 mb-6 rounded-lg px-4 py-3 text-sm"
            style={{
              background: 'rgba(245,158,11,0.08)',
              border:     '1px solid rgba(245,158,11,0.25)',
              color:      'rgb(252,211,77)',
            }}
          >
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>Analyse pågår …</span>
          </div>
        )}

        {/* Tilstandskort — FEILET */}
        {bestilling.status === 'FEILET' && (
          <div
            className="flex items-start gap-3 mb-6 rounded-lg px-4 py-3 text-sm"
            style={{
              background: 'rgba(239,68,68,0.10)',
              border:     '1px solid rgba(239,68,68,0.30)',
              color:      'rgb(252,165,165)',
            }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold mb-0.5">Analysen feilet</div>
              <div>{bestilling.feilmelding ?? 'Ingen feilmelding er registrert.'}</div>
            </div>
          </div>
        )}

        {/* Sammendrag (ved FERDIG) */}
        {bestilling.status === 'FERDIG' && bestilling.sammendrag && (
          <div
            className="mb-6 rounded-lg px-4 py-3 text-sm whitespace-pre-wrap"
            style={{
              background: 'var(--glass-bg)',
              border:     '1px solid var(--glass-bg-hover)',
              color:      'var(--text-primary)',
            }}
          >
            {bestilling.sammendrag}
          </div>
        )}

        {/* Parametre */}
        <section
          className="mb-6 rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--glass-bg-hover)' }}
        >
          <div
            className="px-4 py-2 text-xs font-semibold uppercase tracking-widest"
            style={{ background: 'var(--glass-bg)', color: 'var(--text-muted)' }}
          >
            Parametre
          </div>
          {parameterKeys.length === 0 ? (
            <div className="px-4 py-3 text-sm italic" style={{ background: 'var(--glass-bg)', color: 'var(--text-muted)' }}>
              Ingen parametre.
            </div>
          ) : (
            parameterKeys.map((key, i, arr) => (
              <div
                key={key}
                className="flex items-center gap-4 px-4 py-2.5"
                style={{
                  background:   'var(--glass-bg)',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--glass-bg)' : undefined,
                }}
              >
                <span
                  className="text-xs w-40 shrink-0 uppercase tracking-wider font-semibold"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {key}
                </span>
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  {formaterParameter((parametre as Record<string, unknown>)[key])}
                </span>
              </div>
            ))
          )}
        </section>

        {/* Tidsstempler */}
        <section
          className="mb-6 rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--glass-bg-hover)' }}
        >
          <div
            className="px-4 py-2 text-xs font-semibold uppercase tracking-widest"
            style={{ background: 'var(--glass-bg)', color: 'var(--text-muted)' }}
          >
            Tidslinje
          </div>
          {[
            { label: 'Bestilt',  dato: bestilling.bestiltDato },
            { label: 'Startet',  dato: bestilling.startetDato },
            { label: 'Ferdig',   dato: bestilling.ferdigDato  },
          ].map((rad, i, arr) => (
            <div
              key={rad.label}
              className="flex items-center gap-4 px-4 py-2.5"
              style={{
                background:   'var(--glass-bg)',
                borderBottom: i < arr.length - 1 ? '1px solid var(--glass-bg)' : undefined,
              }}
            >
              <span
                className="text-xs w-40 shrink-0 uppercase tracking-wider font-semibold"
                style={{ color: 'var(--text-muted)' }}
              >
                {rad.label}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {formaterDato(rad.dato)}
              </span>
            </div>
          ))}
        </section>

        {kansellerFeil && (
          <div
            className="mb-4 rounded-lg px-4 py-3 text-sm"
            style={{
              background: 'rgba(239,68,68,0.10)',
              border:     '1px solid rgba(239,68,68,0.30)',
              color:      'rgb(252,165,165)',
            }}
          >
            {kansellerFeil}
          </div>
        )}

        {/* Handlinger */}
        <div className="flex items-center gap-3 flex-wrap">
          {bestilling.status === 'FERDIG' && (
            <button
              type="button"
              disabled
              title="Rapport-nedlasting er ikke tilgjengelig enda (kommer i senere fase)"
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'var(--glass-gold-bg)',
                border:     '1px solid var(--glass-gold-border)',
                color:      'var(--gold)',
              }}
            >
              <Download className="w-4 h-4" />
              Last ned rapport
            </button>
          )}

          {bestilling.status === 'BESTILT' && (
            <button
              type="button"
              onClick={() => void kanseller()}
              disabled={kansellerer}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              style={{
                background: 'rgba(239,68,68,0.10)',
                border:     '1px solid rgba(239,68,68,0.30)',
                color:      'rgb(252,165,165)',
              }}
            >
              {kansellerer ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              {kansellerer ? 'Kansellerer …' : 'Kanseller bestilling'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
