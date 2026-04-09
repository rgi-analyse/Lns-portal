'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, FileBarChart2, RefreshCw, Star } from 'lucide-react';
import AIChat from '@/components/AIChat';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';
import { useLisens } from '@/components/LisensProvider';

interface Workspace {
  id:              string;
  navn:            string;
  beskrivelse?:    string | null;
  erPersonlig?:    boolean;
  kontekstVerdi?:  string | null;
  kontekstLabel?:  string | null;
  _count?: { rapporter: number; tilgang: number };
}

interface Aktivitet {
  sistInnlogget: string | null;
  sistAapnetRapport: { navn: string | null; dato: string } | null;
  sistOppdatertRapport: { navn: string | null; dato: string } | null;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function projectCode(navn: string): string {
  const m = navn.match(/\b(\d{4,5})\b/);
  if (m) return m[1];
  return navn.slice(0, 3).toUpperCase();
}

function formaterDato(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dato = new Date(iso);
  if (isNaN(dato.getTime())) return '—';
  const diffMs = Date.now() - dato.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffTimer = Math.floor(diffMin / 60);
  const diffDager = Math.floor(diffTimer / 24);
  if (diffMin < 1)   return 'akkurat nå';
  if (diffMin < 60)  return `${diffMin} min siden`;
  if (diffTimer < 24) return `${diffTimer}t siden`;
  if (diffDager < 7) return `${diffDager} dager siden`;
  return dato.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
}

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, entraObjectId, displayName, authHeaders, grupper } = usePortalAuth();
  const firstName = displayName.split(' ')[0];

  const [aktivitet,        setAktivitet]        = useState<Aktivitet | null>(null);
  const [workspaces,       setWorkspaces]        = useState<Workspace[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [filter,           setFilter]            = useState<'alle' | 'favoritter'>('favoritter');
  const [favoritter,       setFavoritter]        = useState<string[]>([]);
  const lisens = useLisens();
  const togglingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isAuthenticated || !entraObjectId) return;
    const url = new URL(`${API}/api/workspaces`);
    if (grupper.length > 0) url.searchParams.set('grupper', grupper.join(','));

    apiFetch(url.pathname + url.search, { headers: authHeaders })
      .then((r) => r.json())
      .then((data: Workspace[]) => {
        setWorkspaces(data);
        setLoadingWorkspaces(false);
      })
      .catch(() => {
        setWorkspaces([]);
        setLoadingWorkspaces(false);
      });
  }, [isAuthenticated, entraObjectId, authHeaders, grupper]);

  useEffect(() => {
    if (!isAuthenticated || !entraObjectId) return;
    apiFetch('/api/meg/favoritter', { headers: authHeaders })
      .then((r) => r.json())
      .then((ids: string[]) => setFavoritter(ids))
      .catch(() => setFavoritter([]));
  }, [isAuthenticated, entraObjectId, authHeaders]);

  useEffect(() => {
    if (!isAuthenticated || !entraObjectId) return;
    apiFetch('/api/meg/aktivitet', { headers: authHeaders })
      .then((r) => r.ok ? r.json() : null)
      .then((data: Aktivitet | null) => setAktivitet(data))
      .catch(() => setAktivitet(null));
  }, [isAuthenticated, entraObjectId, authHeaders]);


  async function toggleFavoritt(e: React.MouseEvent, workspaceId: string) {
    e.stopPropagation();
    if (togglingRef.current.has(workspaceId)) return;
    togglingRef.current.add(workspaceId);
    const erFavoritt = favoritter.includes(workspaceId);
    setFavoritter((prev) =>
      erFavoritt ? prev.filter((id) => id !== workspaceId) : [...prev, workspaceId],
    );
    try {
      await apiFetch(`/api/meg/favoritter/${workspaceId}`, {
        method: erFavoritt ? 'DELETE' : 'POST',
        headers: authHeaders,
      });
    } catch {
      setFavoritter((prev) =>
        erFavoritt ? [...prev, workspaceId] : prev.filter((id) => id !== workspaceId),
      );
    } finally {
      togglingRef.current.delete(workspaceId);
    }
  }

  return (
    <>
      <div className="p-8 overflow-y-auto h-full">

        {/* Velkomst */}
        <div className="mb-8">
          <h1
            className="uppercase tracking-wide"
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 800,
              fontSize: 28,
              color: 'var(--text-primary)',
              letterSpacing: '0.03em',
            }}
          >
            Velkommen, {firstName}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Her er en oversikt over tilgjengelige ressurser.
          </p>
        </div>

        {/* Section label — Oversikt */}
        <SectionLabel>Oversikt</SectionLabel>

        {/* Oversikt — 3 aktivitetskort */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">

          {/* Kort 1: Sist innlogget */}
          <div
            className="flex items-center gap-4"
            style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid var(--glass-bg-hover)',
              borderRadius: 14,
              padding: '20px 24px',
            }}
          >
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'var(--glass-bg-hover)', border: '1px solid var(--glass-border)' }}
            >
              <Clock className="w-6 h-6" style={{ color: 'var(--text-secondary)' }} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest font-semibold"
                style={{ color: 'var(--text-muted)' }}>
                Sist innlogget
              </p>
              <p style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 700,
                fontSize: 18,
                color: 'var(--text-primary)',
                lineHeight: 1.2,
                marginTop: 4,
              }}>
                {aktivitet === null
                  ? <span className="inline-block w-24 h-5 rounded animate-pulse"
                      style={{ background: 'var(--glass-bg-hover)' }} />
                  : formaterDato(aktivitet.sistInnlogget)}
              </p>
            </div>
          </div>

          {/* Kort 2: Siste åpnet rapport */}
          <div
            className="flex items-center gap-4"
            style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid var(--glass-bg-hover)',
              borderRadius: 14,
              padding: '20px 24px',
            }}
          >
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'var(--glass-gold-bg)', border: '1px solid var(--glass-gold-border)' }}
            >
              <FileBarChart2 className="w-6 h-6" style={{ color: 'var(--gold)' }} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest font-semibold"
                style={{ color: 'var(--text-muted)' }}>
                Siste åpnet rapport
              </p>
              {aktivitet === null ? (
                <span className="inline-block w-32 h-5 rounded animate-pulse mt-1"
                  style={{ background: 'var(--glass-bg-hover)' }} />
              ) : aktivitet.sistAapnetRapport ? (
                <>
                  <p className="truncate" style={{
                    fontFamily: 'Barlow Condensed, sans-serif',
                    fontWeight: 700,
                    fontSize: 16,
                    color: 'var(--text-primary)',
                    marginTop: 4,
                  }}>
                    {aktivitet.sistAapnetRapport.navn ?? '—'}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    {formaterDato(aktivitet.sistAapnetRapport.dato)}
                  </p>
                </>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  Ingen åpnet ennå
                </p>
              )}
            </div>
          </div>

          {/* Kort 3: Sist oppdatert rapport */}
          <div
            className="flex items-center gap-4"
            style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid var(--glass-bg-hover)',
              borderRadius: 14,
              padding: '20px 24px',
            }}
          >
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: 'rgba(16,185,129,0.10)',
                border: '1px solid rgba(16,185,129,0.20)',
              }}
            >
              <RefreshCw className="w-6 h-6" style={{ color: 'rgba(110,231,183,0.9)' }} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest font-semibold"
                style={{ color: 'var(--text-muted)' }}>
                Sist oppdatert rapport
              </p>
              {aktivitet === null ? (
                <span className="inline-block w-32 h-5 rounded animate-pulse mt-1"
                  style={{ background: 'var(--glass-bg-hover)' }} />
              ) : aktivitet.sistOppdatertRapport ? (
                <>
                  <p className="truncate" style={{
                    fontFamily: 'Barlow Condensed, sans-serif',
                    fontWeight: 700,
                    fontSize: 16,
                    color: 'var(--text-primary)',
                    marginTop: 4,
                  }}>
                    {aktivitet.sistOppdatertRapport.navn}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    {formaterDato(aktivitet.sistOppdatertRapport.dato)}
                  </p>
                </>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  Ingen rapporter ennå
                </p>
              )}
            </div>
          </div>

        </div>

        {/* Section label + filter-tabs */}
        <div className="flex items-center gap-3 mb-4">
          <span style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
          }}>
            Workspaces
          </span>

          {/* Filter-tabs */}
          <div className="flex items-center gap-1.5">
            {(['favoritter', 'alle'] as const).map((val) => (
              <button
                key={val}
                onClick={() => setFilter(val)}
                className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                style={filter === val ? {
                  background: 'var(--glass-gold-bg)',
                  border: '1px solid var(--glass-gold-border)',
                  color: 'var(--gold)',
                } : {
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--glass-bg-hover)',
                  color: 'var(--text-muted)',
                }}
              >
                {val === 'favoritter' ? 'Favoritter' : 'Alle'}
              </button>
            ))}
          </div>

          <div className="flex-1 h-px" style={{ background: 'var(--glass-bg)' }} />
        </div>

        {/* Workspace-kort */}
        {(() => {
          const viserWorkspaces = workspaces.filter((w) =>
            filter === 'alle' || favoritter.includes(w.id)
          );

          if (loadingWorkspaces) {
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="animate-pulse" style={{
                    height: 72,
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-bg)',
                    borderRadius: 14,
                  }} />
                ))}
              </div>
            );
          }

          if (viserWorkspaces.length === 0) {
            return (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {filter === 'favoritter'
                  ? 'Du har ingen favoritter ennå. Klikk på stjernen på et workspace for å pinne det her.'
                  : 'Ingen workspaces tilgjengelig.'}
              </p>
            );
          }

          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {viserWorkspaces.map((ws) => (
                <div
                  key={ws.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/dashboard/workspace/${ws.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') router.push(`/dashboard/workspace/${ws.id}`); }}
                  className="flex items-center gap-3 text-left w-full transition-all duration-150"
                  style={{
                    background: 'var(--glass-bg)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    border: '1px solid var(--glass-bg-hover)',
                    borderRadius: 14,
                    padding: '16px 18px',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = 'var(--glass-bg)';
                    (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--glass-gold-border)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = 'var(--glass-bg)';
                    (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--glass-bg-hover)';
                  }}
                >
                  {/* Prosjektnummer-ikon */}
                  <div
                    className="flex items-center justify-center shrink-0"
                    style={{
                      width: 44, height: 44,
                      background: 'linear-gradient(135deg, rgba(27,42,74,0.8), rgba(36,53,86,0.8))',
                      border: '1px solid var(--glass-gold-border)',
                      borderRadius: 10,
                      fontFamily: 'Barlow Condensed, sans-serif',
                      fontWeight: 800, fontSize: 13, color: 'var(--gold)',
                    }}
                  >
                    {projectCode(ws.navn)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="truncate" style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                      {ws.navn}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span>{ws._count?.rapporter ?? 0} rapporter</span>
                      {ws.beskrivelse && <span>· {ws.beskrivelse}</span>}
                      {(ws.kontekstVerdi || ws.kontekstLabel) && (
                        <span style={{
                          fontSize: 10, fontWeight: 600,
                          padding: '1px 6px', borderRadius: 4,
                          background: 'var(--glass-gold-bg)',
                          border: '1px solid var(--glass-gold-border)',
                          color: 'var(--gold)',
                        }}>
                          {ws.kontekstLabel ?? ws.kontekstVerdi}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stjerne-favoritt */}
                  <button
                    type="button"
                    onClick={(e) => void toggleFavoritt(e, ws.id)}
                    title={favoritter.includes(ws.id) ? 'Fjern favoritt' : 'Legg til favoritt'}
                    style={{
                      flexShrink: 0,
                      background: 'none',
                      border: 'none',
                      padding: '4px',
                      cursor: 'pointer',
                      color: favoritter.includes(ws.id) ? 'var(--gold)' : 'var(--text-muted)',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (!favoritter.includes(ws.id))
                        (e.currentTarget as HTMLButtonElement).style.color = 'var(--gold-dim)';
                    }}
                    onMouseLeave={(e) => {
                      if (!favoritter.includes(ws.id))
                        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
                    }}
                  >
                    <Star
                      size={16}
                      fill={favoritter.includes(ws.id) ? 'var(--gold)' : 'none'}
                      stroke={favoritter.includes(ws.id) ? 'var(--gold)' : 'currentColor'}
                    />
                  </button>

                  {/* Pil */}
                  <div style={{ color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, flexShrink: 0 }}>
                    ›
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
      {lisens.chatAktivert && <AIChat entraObjectId={entraObjectId} grupper={grupper} />}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span style={{
        fontFamily: 'Barlow Condensed, sans-serif',
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: '0.10em',
        textTransform: 'uppercase' as const,
        color: 'var(--text-muted)',
        whiteSpace: 'nowrap' as const,
      }}>
        {children}
      </span>
      <div className="flex-1 h-px" style={{ background: 'var(--glass-bg)' }} />
    </div>
  );
}
