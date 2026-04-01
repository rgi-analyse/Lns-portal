'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, FileBarChart2, Clock, Star } from 'lucide-react';
import AIChat from '@/components/AIChat';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';

interface Workspace {
  id: string;
  navn: string;
  beskrivelse?: string | null;
  erPersonlig?: boolean;
  _count?: { rapporter: number; tilgang: number };
}

interface Stats {
  workspaces: number;
  rapporter: number;
}

interface Aktivitet {
  sisteAktiv: string | null;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function projectCode(navn: string): string {
  const m = navn.match(/\b(\d{4,5})\b/);
  if (m) return m[1];
  return navn.slice(0, 3).toUpperCase();
}

const statCards = [
  {
    label: 'Workspaces',
    key: 'workspaces' as const,
    Icon: LayoutDashboard,
    iconBg: 'rgba(27,42,74,0.60)',
    iconBorder: 'var(--glass-border)',
    iconColor: 'var(--text-secondary)',
  },
  {
    label: 'Rapporter',
    key: 'rapporter' as const,
    Icon: FileBarChart2,
    iconBg: 'var(--glass-gold-bg)',
    iconBorder: 'var(--glass-gold-border)',
    iconColor: 'var(--gold)',
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, entraObjectId, displayName, authHeaders, grupper } = usePortalAuth();
  const firstName = displayName.split(' ')[0];

  const [stats,      setStats]      = useState<Stats | null>(null);
  const [aktivitet,  setAktivitet]  = useState<Aktivitet | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [filter,     setFilter]     = useState<'alle' | 'favoritter'>('favoritter');
  const [favoritter, setFavoritter] = useState<string[]>([]);
  const togglingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isAuthenticated || !entraObjectId) return;
    const url = new URL(`${API}/api/workspaces`);
    if (grupper.length > 0) url.searchParams.set('grupper', grupper.join(','));

    apiFetch(url.pathname + url.search, { headers: authHeaders })
      .then((r) => r.json())
      .then((data: Workspace[]) => {
        setWorkspaces(data);
        setStats({
          workspaces: data.length,
          rapporter:  data.reduce((sum, ws) => sum + (ws._count?.rapporter ?? 0), 0),
        });
      })
      .catch(() => {
        setWorkspaces([]);
        setStats({ workspaces: 0, rapporter: 0 });
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
      .then((r) => r.json())
      .then((data: Aktivitet) => setAktivitet(data))
      .catch(() => setAktivitet({ sisteAktiv: null }));
  }, [isAuthenticated, entraObjectId, authHeaders]);

  async function toggleFavoritt(e: React.MouseEvent, workspaceId: string) {
    e.stopPropagation();
    if (togglingRef.current.has(workspaceId)) return;
    togglingRef.current.add(workspaceId);
    const erFavoritt = favoritter.includes(workspaceId);
    // Optimistisk oppdatering
    setFavoritter((prev) =>
      erFavoritt ? prev.filter((id) => id !== workspaceId) : [...prev, workspaceId],
    );
    try {
      await apiFetch(`/api/meg/favoritter/${workspaceId}`, {
        method: erFavoritt ? 'DELETE' : 'POST',
        headers: authHeaders,
      });
    } catch {
      // Rull tilbake ved feil
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

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {statCards.map(({ label, key, Icon, iconBg, iconBorder, iconColor }) => (
            <div
              key={label}
              className="flex items-center gap-4 transition-all duration-150 cursor-default"
              style={{
                background: 'var(--glass-bg)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid var(--glass-bg-hover)',
                borderRadius: 14,
                padding: '20px 24px',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'var(--glass-bg-hover)';
                (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--glass-gold-border)';
                (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'var(--glass-bg)';
                (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--glass-bg-hover)';
                (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
              }}
            >
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: iconBg, border: `1px solid ${iconBorder}` }}
              >
                <Icon className="w-6 h-6" style={{ color: iconColor }} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold"
                  style={{ color: 'var(--text-secondary)' }}>
                  {label}
                </p>
                <p style={{
                  fontFamily: 'Barlow Condensed, sans-serif',
                  fontWeight: 800,
                  fontSize: 30,
                  color: 'var(--text-primary)',
                  lineHeight: 1,
                  marginTop: 2,
                }}>
                  {stats === null ? (
                    <span
                      className="inline-block w-8 h-7 rounded animate-pulse"
                      style={{ background: 'var(--glass-bg-hover)' }}
                    />
                  ) : (
                    stats[key]
                  )}
                </p>
              </div>
            </div>
          ))}

          {/* Siste aktivitet-kort */}
          <div
            className="flex items-center gap-4 transition-all duration-150 cursor-default"
            style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid var(--glass-bg-hover)',
              borderRadius: 14,
              padding: '20px 24px',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'var(--glass-bg-hover)';
              (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--glass-gold-border)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'var(--glass-bg)';
              (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--glass-bg-hover)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
            }}
          >
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: 'rgba(16,185,129,0.10)',
                border: '1px solid rgba(16,185,129,0.20)',
              }}
            >
              <Clock className="w-6 h-6" style={{ color: 'rgba(110,231,183,0.9)' }} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold"
                style={{ color: 'var(--text-secondary)' }}>
                Siste aktivitet
              </p>
              <p style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 800,
                fontSize: 22,
                color: 'var(--text-primary)',
                lineHeight: 1,
                marginTop: 4,
              }}>
                {aktivitet === null ? (
                  <span
                    className="inline-block w-16 h-6 rounded animate-pulse"
                    style={{ background: 'var(--glass-bg-hover)' }}
                  />
                ) : (
                  formaterAktivitet(aktivitet.sisteAktiv)
                )}
              </p>
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

          if (stats === null) {
            // Loading-skjelett
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
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {ws._count?.rapporter ?? 0} rapporter
                      {ws.beskrivelse ? ` · ${ws.beskrivelse}` : ''}
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
      <AIChat entraObjectId={entraObjectId} />
    </>
  );
}

function formaterAktivitet(iso: string | null): string {
  if (!iso) return 'Ingen';
  const dato = new Date(iso);
  if (isNaN(dato.getTime())) return 'Ukjent';
  const nå = Date.now();
  const diffMs = nå - dato.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1)  return 'Akkurat nå';
  if (diffMin < 60) return `${diffMin}m siden`;
  const diffTimer = Math.floor(diffMin / 60);
  if (diffTimer < 24) return `${diffTimer}t siden`;
  const diffDager = Math.floor(diffTimer / 24);
  if (diffDager === 1) return 'I går';
  if (diffDager < 7)  return `${diffDager}d siden`;
  if (diffDager < 30) return `${Math.floor(diffDager / 7)}u siden`;
  return dato.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
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
