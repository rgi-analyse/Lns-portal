'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, TrendingUp, Loader2 } from 'lucide-react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';

// ── JSON Schema-typer (støttet subsett) ────────────────────────────────────
interface SchemaProperty {
  type?:        'string' | 'number' | 'integer' | 'boolean';
  title?:       string;
  description?: string;
  format?:      'date' | 'date-time' | string;
  enum?:        (string | number)[];
  default?:     string | number | boolean;
  minimum?:     number;
  maximum?:     number;
}

interface ParametreSchema {
  type?:       'object';
  properties?: Record<string, SchemaProperty>;
  required?:   string[];
}

interface AnalyseType {
  id:              string;
  navn:            string;
  beskrivelse:     string | null;
  ikon:            string | null;
  parametreSchema: ParametreSchema | null;
}

// ── Hjelpere ───────────────────────────────────────────────────────────────
function initialVerdier(schema: ParametreSchema | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema?.properties) return out;
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.default !== undefined) out[key] = prop.default;
    else if (prop.type === 'boolean') out[key] = false;
    else out[key] = '';
  }
  return out;
}

function validerKlient(
  schema: ParametreSchema | null,
  verdier: Record<string, unknown>,
): string | null {
  if (!schema?.properties) return null;
  for (const key of schema.required ?? []) {
    const v = verdier[key];
    if (v === undefined || v === null || v === '') {
      const label = schema.properties[key]?.title ?? key;
      return `Feltet "${label}" er påkrevd.`;
    }
  }
  return null;
}

// Konverterer skjemaverdier (alt som strenger for tall/dato) til typer matchende JSON Schema
function normaliserVerdier(
  schema: ParametreSchema | null,
  verdier: Record<string, unknown>,
): Record<string, unknown> {
  if (!schema?.properties) return verdier;
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const raw = verdier[key];
    if (raw === undefined || raw === '') continue;
    if (prop.type === 'number' || prop.type === 'integer') {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!isNaN(n)) out[key] = prop.type === 'integer' ? Math.trunc(n) : n;
    } else if (prop.type === 'boolean') {
      out[key] = Boolean(raw);
    } else {
      out[key] = String(raw);
    }
  }
  return out;
}

// ── Hovedkomponent ─────────────────────────────────────────────────────────
export default function NyAnalysePage() {
  const router = useRouter();
  const { isAuthenticated, entraObjectId, authHeaders } = usePortalAuth();

  const [typer, setTyper]             = useState<AnalyseType[] | null>(null);
  const [valgtTypeId, setValgtTypeId] = useState<string | null>(null);
  const [verdier, setVerdier]         = useState<Record<string, unknown>>({});
  const [tittel, setTittel]           = useState('');
  const [sender, setSender]           = useState(false);
  const [feil, setFeil]               = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !entraObjectId) return;
    apiFetch('/api/analyse/typer', { headers: authHeaders, cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 403) {
          setFeil('Du har ikke tilgang til analyse-modulen.');
          setTyper([]);
          return;
        }
        if (!r.ok) throw new Error('load failed');
        const data: AnalyseType[] = await r.json();
        setTyper(data);
      })
      .catch(() => {
        setFeil('Kunne ikke laste analysetyper.');
        setTyper([]);
      });
  }, [isAuthenticated, entraObjectId, authHeaders]);

  const valgtType = typer?.find((t) => t.id === valgtTypeId) ?? null;

  function velgType(t: AnalyseType) {
    setValgtTypeId(t.id);
    setVerdier(initialVerdier(t.parametreSchema));
    setTittel('');
    setFeil(null);
  }

  async function submit() {
    if (!valgtType) return;
    setFeil(null);

    const valideringsfeil = validerKlient(valgtType.parametreSchema, verdier);
    if (valideringsfeil) {
      setFeil(valideringsfeil);
      return;
    }

    const body = {
      analyseTypeId: valgtType.id,
      parametre:     normaliserVerdier(valgtType.parametreSchema, verdier),
      ...(tittel.trim() ? { tittel: tittel.trim() } : {}),
    };

    setSender(true);
    try {
      const r = await apiFetch('/api/analyse/bestillinger', {
        method:  'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!r.ok) {
        const detail = await r.json().catch(() => ({}));
        throw new Error(detail?.error ?? 'Kunne ikke opprette bestilling');
      }
      const opprettet = await r.json() as { id: string };
      router.push(`/dashboard/analyse/${opprettet.id}`);
    } catch (err) {
      setFeil(err instanceof Error ? err.message : 'Ukjent feil');
      setSender(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">

        {/* Tilbake-link */}
        <button
          onClick={() => valgtType ? setValgtTypeId(null) : router.push('/dashboard/analyse')}
          className="flex items-center gap-1.5 text-sm mb-6 transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}
        >
          <ChevronLeft className="w-4 h-4" />
          {valgtType ? 'Velg annen analysetype' : 'Tilbake til mine analyser'}
        </button>

        <h1
          className="uppercase tracking-wide mb-2"
          style={{
            fontFamily:    'Barlow Condensed, sans-serif',
            fontWeight:    800,
            fontSize:      28,
            color:         'var(--text-primary)',
            letterSpacing: '0.03em',
          }}
        >
          {valgtType ? valgtType.navn : 'Bestill ny analyse'}
        </h1>
        <p className="mb-8 text-sm" style={{ color: 'var(--text-muted)' }}>
          {valgtType
            ? (valgtType.beskrivelse ?? 'Fyll ut parametrene for analysen.')
            : 'Velg hvilken type analyse du ønsker å bestille.'}
        </p>

        {feil && (
          <div
            className="mb-6 rounded-lg px-4 py-3 text-sm"
            style={{
              background: 'rgba(239,68,68,0.10)',
              border:     '1px solid rgba(239,68,68,0.30)',
              color:      'rgb(252,165,165)',
            }}
          >
            {feil}
          </div>
        )}

        {/* Steg 1: Velg analysetype */}
        {!valgtType && (
          typer === null ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse"
                  style={{
                    height:       110,
                    background:   'var(--glass-bg)',
                    border:       '1px solid var(--glass-bg)',
                    borderRadius: 14,
                  }}
                />
              ))}
            </div>
          ) : typer.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Ingen analysetyper er tilgjengelige akkurat nå.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {typer.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => velgType(t)}
                  className="text-left transition-all"
                  style={{
                    background:   'var(--glass-bg)',
                    border:       '1px solid var(--glass-bg-hover)',
                    borderRadius: 14,
                    padding:      '18px 20px',
                    cursor:       'pointer',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-gold-border)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-bg-hover)'; }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width:        40,
                        height:       40,
                        background:   'var(--glass-gold-bg)',
                        border:       '1px solid var(--glass-gold-border)',
                        borderRadius: 10,
                        color:        'var(--gold)',
                        fontSize:     18,
                      }}
                    >
                      {t.ikon ?? <TrendingUp className="w-5 h-5" />}
                    </div>
                    <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                      {t.navn}
                    </span>
                  </div>
                  {t.beskrivelse && (
                    <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {t.beskrivelse}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )
        )}

        {/* Steg 2: Parameter-skjema */}
        {valgtType && (
          <form
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
            className="space-y-5"
          >
            <DynamiskSkjema
              schema={valgtType.parametreSchema}
              verdier={verdier}
              onChange={setVerdier}
            />

            {/* Tittel (valgfri) */}
            <div>
              <label
                className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-muted)' }}
              >
                Tittel (valgfri)
              </label>
              <input
                type="text"
                value={tittel}
                onChange={(e) => setTittel(e.target.value)}
                placeholder={`F.eks. "${valgtType.navn} — mars 2026"`}
                maxLength={500}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  background: 'var(--glass-bg)',
                  border:     '1px solid var(--glass-bg-hover)',
                  color:      'var(--text-primary)',
                }}
              />
            </div>

            {/* Submit */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={sender}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--glass-gold-bg)',
                  border:     '1px solid var(--glass-gold-border)',
                  color:      'var(--gold)',
                }}
              >
                {sender && <Loader2 className="w-4 h-4 animate-spin" />}
                {sender ? 'Sender bestilling…' : 'Bestill analyse'}
              </button>
              <button
                type="button"
                onClick={() => setValgtTypeId(null)}
                disabled={sender}
                className="px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                style={{ color: 'var(--text-muted)' }}
              >
                Avbryt
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Dynamisk skjema fra JSON Schema ────────────────────────────────────────
function DynamiskSkjema({
  schema, verdier, onChange,
}: {
  schema:   ParametreSchema | null;
  verdier:  Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  if (!schema?.properties || Object.keys(schema.properties).length === 0) {
    return (
      <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
        Denne analysetypen har ingen parametre.
      </p>
    );
  }

  const påkrevde = new Set(schema.required ?? []);

  function sett(key: string, v: unknown) {
    onChange({ ...verdier, [key]: v });
  }

  return (
    <div className="space-y-4">
      {Object.entries(schema.properties).map(([key, prop]) => {
        const label = prop.title ?? key;
        const erPåkrevd = påkrevde.has(key);
        const inputStil: React.CSSProperties = {
          background: 'var(--glass-bg)',
          border:     '1px solid var(--glass-bg-hover)',
          color:      'var(--text-primary)',
        };

        return (
          <div key={key}>
            <label
              className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--text-muted)' }}
            >
              {label}
              {erPåkrevd && <span style={{ color: 'var(--gold)' }}> *</span>}
            </label>

            {prop.enum ? (
              <select
                value={String(verdier[key] ?? '')}
                onChange={(e) => sett(key, e.target.value)}
                required={erPåkrevd}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={inputStil}
              >
                <option value="" disabled>Velg …</option>
                {prop.enum.map((v) => (
                  <option key={String(v)} value={String(v)}>{String(v)}</option>
                ))}
              </select>
            ) : prop.type === 'boolean' ? (
              <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--text-primary)' }}>
                <input
                  type="checkbox"
                  checked={!!verdier[key]}
                  onChange={(e) => sett(key, e.target.checked)}
                />
                {label}
              </label>
            ) : prop.format === 'date' ? (
              <input
                type="date"
                value={String(verdier[key] ?? '')}
                onChange={(e) => sett(key, e.target.value)}
                required={erPåkrevd}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={inputStil}
              />
            ) : prop.type === 'number' || prop.type === 'integer' ? (
              <input
                type="number"
                value={String(verdier[key] ?? '')}
                onChange={(e) => sett(key, e.target.value)}
                required={erPåkrevd}
                min={prop.minimum}
                max={prop.maximum}
                step={prop.type === 'integer' ? 1 : 'any'}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={inputStil}
              />
            ) : (
              <input
                type="text"
                value={String(verdier[key] ?? '')}
                onChange={(e) => sett(key, e.target.value)}
                required={erPåkrevd}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={inputStil}
              />
            )}

            {prop.description && (
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                {prop.description}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
