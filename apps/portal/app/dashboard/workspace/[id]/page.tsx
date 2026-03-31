'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileBarChart2, BarChart2, Pencil } from 'lucide-react';
import AIChat from '@/components/AIChat';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';

interface Rapport {
  id: string;
  navn: string;
  beskrivelse?: string | null;
  område?: string | null;
  erDesignerRapport?: boolean;
  opprettetDato?: string | null;
  oppdatert?: string | null;
}

function formaterDato(dato: string | null | undefined): string {
  if (!dato) return '';
  return new Date(dato).toLocaleDateString('nb-NO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

interface WorkspaceDetail {
  id: string;
  navn: string;
  beskrivelse?: string | null;
  rapporter: Array<{ rapport: Rapport; rekkefølge: number }>;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function projectCode(navn: string): string {
  const m = navn.match(/\b(\d{4,5})\b/);
  if (m) return m[1];
  return navn.slice(0, 3).toUpperCase();
}

export default function WorkspacePage() {
  const { id }                             = useParams<{ id: string }>();
  const router                             = useRouter();
  const { isAuthenticated, entraObjectId, authHeaders, grupper } = usePortalAuth();

  const [workspace,     setWorkspace]     = useState<WorkspaceDetail | null>(null);
  const [rapporter,     setRapporter]     = useState<Rapport[]>([]);
  const [error,         setError]         = useState<string | null>(null);
  // Inline redigering
  const [redigererId,   setRedigererId]   = useState<string | null>(null);
  const [redigererNavn, setRedigererNavn] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isAuthenticated) { router.replace('/'); return; }
    if (!id) return;

    async function load() {
      const wsUrl = new URL(`${API}/api/workspaces/${id}`);
      if (grupper.length > 0) wsUrl.searchParams.set('grupper', grupper.join(','));
      const wsRes = await apiFetch(wsUrl.pathname + wsUrl.search, { headers: authHeaders });
      if (!wsRes.ok) throw new Error(`HTTP ${wsRes.status}`);
      const ws = await wsRes.json() as WorkspaceDetail;
      setWorkspace(ws);

      // Hent rapporter via dedikert rute (samme som sidebar bruker)
      const rUrl = new URL(`${API}/api/workspaces/${id}/rapporter`);
      if (grupper.length > 0) rUrl.searchParams.set('grupper', grupper.join(','));
      const rRes = await apiFetch(rUrl.pathname + rUrl.search, { headers: authHeaders });
      if (rRes.ok) {
        const rapporter = await rRes.json() as Rapport[];
        setRapporter(rapporter);
      }
    }

    load().catch(() => setError('Workspace ikke funnet eller du har ikke tilgang.'));
  }, [id, isAuthenticated, authHeaders, grupper, router]);

  // ── Inline redigering ────────────────────────────────────────────────────────

  const startRedigering = (rapport: Rapport) => {
    setRedigererId(rapport.id);
    setRedigererNavn(rapport.navn);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const avbrytRedigering = () => {
    setRedigererId(null);
    setRedigererNavn('');
  };

  const lagreNavn = async (rapportId: string) => {
    if (!redigererNavn.trim()) { avbrytRedigering(); return; }
    try {
      const res = await apiFetch(`/api/rapport-designer/${rapportId}/navn`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ navn: redigererNavn.trim() }),
      });
      if (res.ok) {
        setRapporter((prev) =>
          prev.map((r) => r.id === rapportId ? { ...r, navn: redigererNavn.trim() } : r),
        );
      }
    } catch (err) {
      console.error('[Workspace] navnendring feilet:', err);
    } finally {
      avbrytRedigering();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, rapportId: string) => {
    if (e.key === 'Enter')  { e.preventDefault(); lagreNavn(rapportId); }
    if (e.key === 'Escape') { avbrytRedigering(); }
  };

  const slettRapport = async (rapportId: string, navn: string) => {
    if (!confirm(`Slette "${navn}"? Dette kan ikke angres.`)) return;
    try {
      const res = await apiFetch(`/api/rapport-designer/${rapportId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: authHeaders,
      });
      if (res.ok || res.status === 204) {
        setRapporter((prev) => prev.filter((r) => r.id !== rapportId));
      }
    } catch (err) {
      console.error('[Workspace] sletting feilet:', err);
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="rounded-xl p-6 max-w-md" style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.20)',
        }}>
          <h2 className="font-semibold mb-2" style={{ color: 'rgba(252,165,165,0.9)' }}>Ingen tilgang</h2>
          <p className="text-sm" style={{ color: 'rgba(252,165,165,0.70)' }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .rapport-rad:hover .rapport-actions { opacity: 1 !important; }
      `}</style>

      <div className="p-8 overflow-y-auto h-full">

        {/* Tilbake-knapp */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 mb-6 text-sm transition-colors"
          style={{ color: 'rgba(255,255,255,0.35)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.75)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.35)'; }}
        >
          <ArrowLeft className="w-4 h-4" />
          Tilbake
        </button>

        {workspace === null ? (
          /* Loading-skjelett */
          <div className="animate-pulse space-y-6">
            <div style={{ height: 32, width: 280, background: 'rgba(255,255,255,0.06)', borderRadius: 8 }} />
            <div style={{ height: 16, width: 200, background: 'rgba(255,255,255,0.04)', borderRadius: 6 }} />
            <div className="space-y-2 mt-8">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ height: 56, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 }} />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-4 mb-2">
              <div
                className="flex items-center justify-center shrink-0"
                style={{
                  width: 52, height: 52,
                  background: 'linear-gradient(135deg, rgba(27,42,74,0.8), rgba(36,53,86,0.8))',
                  border: '1px solid rgba(245,166,35,0.25)',
                  borderRadius: 12,
                  fontFamily: 'Barlow Condensed, sans-serif',
                  fontWeight: 800, fontSize: 15, color: 'var(--gold)',
                }}
              >
                {projectCode(workspace.navn)}
              </div>
              <div>
                <h1 style={{
                  fontFamily: 'Barlow Condensed, sans-serif',
                  fontWeight: 800,
                  fontSize: 26,
                  color: 'rgba(255,255,255,0.90)',
                  letterSpacing: '0.02em',
                  lineHeight: 1.1,
                }}>
                  {workspace.navn}
                </h1>
                {workspace.beskrivelse && (
                  <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {workspace.beskrivelse}
                  </p>
                )}
              </div>
            </div>

            {/* Meta */}
            <p className="mb-8 text-xs" style={{ color: 'rgba(255,255,255,0.45)', marginLeft: 68 }}>
              {rapporter.length} rapport{rapporter.length !== 1 ? 'er' : ''}
            </p>

            {/* Section label */}
            <div className="flex items-center gap-3 mb-4">
              <span style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 700, fontSize: 12,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                whiteSpace: 'nowrap',
              }}>
                Rapporter
              </span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            </div>

            {/* Rapport-liste */}
            {rapporter.length === 0 ? (
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Ingen rapporter i dette workspacet.
              </p>
            ) : (
              <div className="space-y-1.5" style={{ maxWidth: 680 }}>
                {rapporter.map((rapport) => (
                  <div
                    key={rapport.id}
                    className="rapport-rad"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      cursor: redigererId === rapport.id ? 'default' : 'pointer',
                    }}
                    onClick={() => {
                      if (redigererId !== rapport.id) {
                        if (rapport.erDesignerRapport) {
                          router.push(`/dashboard/rapport-interaktiv?rapportId=${rapport.id}&fraLagret=true`);
                        } else {
                          router.push(`/dashboard/rapport/${rapport.id}`);
                        }
                      }
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.13)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.07)';
                    }}
                  >
                    {/* Rapport-ikon */}
                    <div style={{
                      width: 32, height: 32,
                      borderRadius: 7,
                      background: rapport.erDesignerRapport
                        ? 'var(--glass-gold-bg)'
                        : 'rgba(59,130,246,0.10)',
                      border: rapport.erDesignerRapport
                        ? '1px solid var(--glass-gold-border)'
                        : '1px solid rgba(59,130,246,0.20)',
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'center', flexShrink: 0,
                    }}>
                      {rapport.erDesignerRapport
                        ? <BarChart2 className="w-3.5 h-3.5" style={{ color: 'var(--gold)' }} />
                        : <FileBarChart2 className="w-3.5 h-3.5" style={{ color: '#60a5fa' }} />
                      }
                    </div>

                    {/* Navn — inline redigering */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {redigererId === rapport.id ? (
                        <input
                          ref={inputRef}
                          type="text"
                          value={redigererNavn}
                          onChange={(e) => setRedigererNavn(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, rapport.id)}
                          onBlur={() => lagreNavn(rapport.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid rgba(245,166,35,0.40)',
                            borderRadius: 5,
                            padding: '3px 8px',
                            color: 'rgba(255,255,255,0.90)',
                            fontSize: 13,
                            fontWeight: 500,
                            width: '100%',
                            outline: 'none',
                          }}
                        />
                      ) : (
                        <div
                          onDoubleClick={(e) => {
                            if (!rapport.erDesignerRapport) return;
                            e.stopPropagation();
                            startRedigering(rapport);
                          }}
                          style={{
                            fontSize: 13, fontWeight: 500,
                            color: 'rgba(255,255,255,0.85)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                        >
                          {rapport.navn}
                        </div>
                      )}
                      {rapport.erDesignerRapport && redigererId !== rapport.id && (
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginTop: 1, display: 'flex', gap: 8 }}>
                          <span>Designer-rapport</span>
                          {(rapport.oppdatert || rapport.opprettetDato) && (
                            <span>
                              {rapport.oppdatert
                                ? `Oppdatert ${formaterDato(rapport.oppdatert)}`
                                : `Opprettet ${formaterDato(rapport.opprettetDato)}`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Handlingsknapper — vises ved hover */}
                    <div
                      className="rapport-actions"
                      style={{ display: 'flex', gap: 4, flexShrink: 0, opacity: 0, transition: 'opacity 0.15s' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {rapport.erDesignerRapport && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); startRedigering(rapport); }}
                            title="Endre navn"
                            style={{
                              width: 26, height: 26, borderRadius: 5,
                              border: '1px solid rgba(255,255,255,0.10)',
                              background: 'rgba(255,255,255,0.05)',
                              color: 'rgba(255,255,255,0.45)',
                              cursor: 'pointer', display: 'flex',
                              alignItems: 'center', justifyContent: 'center',
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.80)';
                              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.22)';
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.45)';
                              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.10)';
                            }}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); slettRapport(rapport.id, rapport.navn); }}
                            title="Slett rapport"
                            style={{
                              width: 26, height: 26, borderRadius: 5,
                              border: '1px solid rgba(239,68,68,0.15)',
                              background: 'rgba(239,68,68,0.05)',
                              color: 'rgba(239,68,68,0.40)',
                              cursor: 'pointer', display: 'flex',
                              alignItems: 'center', justifyContent: 'center',
                              fontSize: 13,
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.color = '#ef4444';
                              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.40)';
                              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.12)';
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(239,68,68,0.40)';
                              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.15)';
                              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.05)';
                            }}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <AIChat entraObjectId={entraObjectId} />
    </>
  );
}
