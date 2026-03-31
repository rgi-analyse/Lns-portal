'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, LayoutDashboard, Building2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface Rapport {
  id: string;
  navn: string;
  erDesignerRapport?: boolean;
}

interface Workspace {
  id: string;
  navn: string;
  erPersonlig?: boolean;
  _count?: { rapporter: number };
  rapporter?: Array<{ rapport: { id: string; navn: string }; rekkefølge: number }>;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function projectCode(navn: string): string {
  const m = navn.match(/\b(\d{4,5})\b/);
  if (m) return m[1];
  return navn.slice(0, 2).toUpperCase();
}

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { authHeaders, grupper } = usePortalAuth();

  const [collapsed, setCollapsed] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [expandedWs, setExpandedWs] = useState<Record<string, boolean>>({});
  const [rapporter, setRapporter] = useState<Record<string, Rapport[]>>({});
  const [loadingRapporter, setLoadingRapporter] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!authHeaders['X-Entra-Object-Id']) { setLoadingWorkspaces(false); return; }

    const url = new URL(`${API}/api/workspaces`);
    if (grupper.length > 0) url.searchParams.set('grupper', grupper.join(','));

    apiFetch(url.pathname + url.search, { headers: authHeaders, cache: 'no-store' })
      .then((r) => r.json())
      .then((data: Workspace[]) => {
        // Personlige workspaces øverst
        data.sort((a, b) => (b.erPersonlig ? 1 : 0) - (a.erPersonlig ? 1 : 0));
        setWorkspaces(data);
        const preloaded: Record<string, Rapport[]> = {};
        data.forEach((ws) => {
          if (ws.rapporter) preloaded[ws.id] = ws.rapporter.map((wr) => wr.rapport);
        });
        setRapporter(preloaded);
      })
      .catch(() => setWorkspaces([]))
      .finally(() => setLoadingWorkspaces(false));
  }, [authHeaders, grupper, pathname]);

  const toggleWorkspace = async (wsId: string) => {
    const next = !expandedWs[wsId];
    setExpandedWs((prev) => ({ ...prev, [wsId]: next }));
    if (next) {
      setLoadingRapporter((prev) => ({ ...prev, [wsId]: true }));
      try {
        const url = new URL(`${API}/api/workspaces/${wsId}/rapporter`);
        if (grupper.length > 0) url.searchParams.set('grupper', grupper.join(','));
        const r = await apiFetch(url.pathname + url.search, { headers: authHeaders, cache: 'no-store' });
        const data: Rapport[] = await r.json();
        setRapporter((prev) => ({ ...prev, [wsId]: data }));
      } catch {
        setRapporter((prev) => ({ ...prev, [wsId]: [] }));
      } finally {
        setLoadingRapporter((prev) => ({ ...prev, [wsId]: false }));
      }
    }
  };

  const isActive = (href: string) => pathname === href;

  return (
    <aside
      className={cn('flex flex-col h-full transition-all duration-200 shrink-0', collapsed ? 'w-14' : 'w-60')}
      style={{
        background: 'rgba(10,22,40,0.65)',
        backdropFilter: 'blur(30px)',
        WebkitBackdropFilter: 'blur(30px)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Logo */}
      <div
        className={cn('flex flex-col items-center shrink-0', collapsed ? 'py-3' : 'px-4 py-4')}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <img
          src="/logo/LNS-logo-hvit-gul-liten-RGB.png"
          alt="LNS"
          className={cn('object-contain shrink-0', collapsed ? 'w-9 h-9' : 'w-14 h-14')}
        />
        {!collapsed && (
          <div style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            color: '#F5A623',
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginTop: 6,
          }}>
            Analyseportal
          </div>
        )}
      </div>

      {/* Toggle */}
      <div className="flex items-center justify-end px-2 pt-2 pb-1">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="p-1.5 rounded-md transition-colors"
          style={{ color: 'rgba(255,255,255,0.50)' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.90)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.50)';
          }}
          aria-label={collapsed ? 'Utvid sidebar' : 'Skjul sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-4">
        {/* Dashboard */}
        <Link
          href="/dashboard"
          className={cn('flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all relative', collapsed && 'justify-center')}
          style={isActive('/dashboard') ? {
            background: 'rgba(245,166,35,0.12)',
            border: '1px solid rgba(245,166,35,0.20)',
            color: '#FFFFFF',
            borderLeft: '2px solid #F5A623',
            paddingLeft: collapsed ? undefined : '10px',
          } : {
            color: 'rgba(255,255,255,0.65)',
          }}
          onMouseEnter={(e) => {
            if (!isActive('/dashboard')) {
              (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.06)';
              (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.90)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive('/dashboard')) {
              (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
              (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.65)';
            }
          }}
        >
          <LayoutDashboard className="w-4 h-4 shrink-0" />
          {!collapsed && <span className="font-medium">Dashboard</span>}
        </Link>

        {/* Workspaces heading */}
        {!collapsed && (
          <p className="px-3 pt-4 pb-1 text-[10px] font-bold tracking-widest uppercase"
            style={{ color: 'rgba(255,255,255,0.45)' }}>
            Workspaces
          </p>
        )}
        {collapsed && <div className="my-2 mx-3 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />}

        {loadingWorkspaces ? (
          <div className="space-y-2 px-1 pt-1">
            <Skeleton className="h-8 w-full opacity-10" />
            <Skeleton className="h-8 w-full opacity-10" />
          </div>
        ) : workspaces.length === 0 ? (
          !collapsed && (
            <p className="px-3 py-1 text-xs italic" style={{ color: 'rgba(255,255,255,0.25)' }}>
              Ingen workspaces
            </p>
          )
        ) : (
          workspaces.map((ws) => {
            const wsActive = !!rapporter[ws.id]?.some((r) => pathname === `/dashboard/rapport/${r.id}`);
            return (
              <div key={ws.id}>
                {/* Workspace row */}
                {collapsed ? (
                  /* Collapsed: navigerer direkte til workspace */
                  <button
                    onClick={() => router.push(`/dashboard/workspace/${ws.id}`)}
                    title={ws.navn}
                    className="w-full flex items-center justify-center px-3 py-2 rounded-lg transition-colors"
                    style={{ color: 'rgba(255,255,255,0.65)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    <Building2 className="w-4 h-4 shrink-0" />
                  </button>
                ) : (
                  /* Expanded: navn-del navigerer, chevron toggler */
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
                    style={wsActive ? {
                      background: 'rgba(245,166,35,0.06)',
                      border: '1px solid rgba(245,166,35,0.12)',
                      color: 'rgba(255,255,255,0.8)',
                    } : {
                      color: 'rgba(255,255,255,0.65)',
                    }}
                    onMouseEnter={(e) => {
                      if (!wsActive) {
                        (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.06)';
                        (e.currentTarget as HTMLDivElement).style.color = 'rgba(255,255,255,0.90)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!wsActive) {
                        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                        (e.currentTarget as HTMLDivElement).style.color = 'rgba(255,255,255,0.65)';
                      }
                    }}
                  >
                    {/* Badge + navn → navigerer */}
                    <button
                      onClick={() => router.push(`/dashboard/workspace/${ws.id}`)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <span
                        className="w-7 h-6 rounded flex items-center justify-center text-[11px] shrink-0"
                        style={{
                          background: ws.erPersonlig ? 'rgba(245,166,35,0.18)' : 'rgba(245,166,35,0.10)',
                          border: ws.erPersonlig ? '1px solid rgba(245,166,35,0.35)' : '1px solid rgba(245,166,35,0.20)',
                          color: '#F5A623',
                          fontFamily: 'Barlow Condensed',
                          fontWeight: 700,
                        }}
                      >
                        {ws.erPersonlig ? '★' : projectCode(ws.navn)}
                      </span>
                      <span className="flex-1 truncate font-medium">{ws.navn}</span>
                      {ws.erPersonlig && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.10em',
                          textTransform: 'uppercase', color: '#F5A623',
                          background: 'rgba(245,166,35,0.10)',
                          border: '1px solid rgba(245,166,35,0.2)',
                          borderRadius: 4, padding: '1px 5px', flexShrink: 0,
                        }}>
                          Mine
                        </span>
                      )}
                    </button>
                    {/* Chevron → toggler rapport-listen */}
                    <button
                      onClick={() => toggleWorkspace(ws.id)}
                      className="shrink-0 p-0.5 rounded transition-colors"
                      style={{ opacity: 0.40 }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.40'; }}
                    >
                      {expandedWs[ws.id]
                        ? <ChevronDown className="w-3.5 h-3.5" />
                        : <ChevronRight className="w-3.5 h-3.5" />
                      }
                    </button>
                  </div>
                )}

                {/* Reports under workspace */}
                {!collapsed && expandedWs[ws.id] && (
                  <div className="ml-5 mt-0.5 space-y-0.5">
                    {loadingRapporter[ws.id] ? (
                      <div className="space-y-1.5 py-1">
                        <Skeleton className="h-5 w-full opacity-10" />
                        <Skeleton className="h-5 w-3/4 opacity-10" />
                      </div>
                    ) : (rapporter[ws.id] ?? []).length === 0 ? (
                      <p className="px-3 py-1 text-xs italic" style={{ color: 'rgba(255,255,255,0.25)' }}>
                        Ingen rapporter
                      </p>
                    ) : (
                      rapporter[ws.id].map((rapport) => {
                        const href = rapport.erDesignerRapport
                          ? `/dashboard/rapport-interaktiv?rapportId=${rapport.id}&fraLagret=true`
                          : `/dashboard/rapport/${rapport.id}`;
                        const active = pathname === href || (rapport.erDesignerRapport && pathname === `/dashboard/rapport-interaktiv` && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('rapportId') === rapport.id);
                        return (
                          <Link
                            key={rapport.id}
                            href={href}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all"
                            style={active ? {
                              background: 'rgba(245,166,35,0.08)',
                              border: '1px solid rgba(245,166,35,0.15)',
                              color: '#F5A623',
                              borderLeft: '2px solid #F5A623',
                              paddingLeft: '10px',
                            } : {
                              color: 'rgba(255,255,255,0.55)',
                            }}
                            onMouseEnter={(e) => {
                              if (!active) {
                                (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.05)';
                                (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.90)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!active) {
                                (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
                                (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.55)';
                              }
                            }}
                          >
                            <span
                              className="w-1 h-1 rounded-full shrink-0"
                              style={{ background: active ? '#F5A623' : 'rgba(255,255,255,0.40)' }}
                            />
                            <span className="truncate">{rapport.navn}</span>
                          </Link>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </nav>
    </aside>
  );
}
