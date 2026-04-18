'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { MessageCircle, Minus, X } from 'lucide-react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { harBetaTilgang } from '@/lib/featureFlags';
import { useLisens } from '@/components/LisensProvider';
import SamtaleHistorikkSidebar from './SamtaleHistorikkSidebar';
import { apiFetch, apiHeaders } from '@/lib/apiClient';
import { useRouter } from 'next/navigation';

const AIChat = dynamic(() => import('@/components/AIChat'), { ssr: false });

interface ChatMelding {
  rolle: string;
  innhold: string;
}

interface AktivSamtaleMeta {
  rapportId: string;
  rapportNavn: string | null;
}

export default function ChatWidget() {
  const { entraObjectId, grupper } = usePortalAuth();
  const lisens = useLisens();
  const router = useRouter();
  const betaBruker = harBetaTilgang(entraObjectId);

  const harSamtalehistorikk = betaBruker;

  console.log('[ChatWidget] entraObjectId:', entraObjectId, '| type:', typeof entraObjectId, '| betaBruker:', betaBruker, '| harSamtalehistorikk:', harSamtalehistorikk);

  const [åpen, setÅpen] = useState(false);
  const [sidebarSynlig, setSidebarSynlig] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const lagret = localStorage.getItem('chat-sidebar-synlig');
    if (lagret !== null) return lagret === 'true';
    return window.innerWidth >= 1100;
  });
  const [chatKey, setChatKey] = useState(0);
  const [initialMessages, setInitialMessages] = useState<{ role: string; content: string }[] | undefined>(undefined);
  const [aktivSamtaleMeta, setAktivSamtaleMeta] = useState<AktivSamtaleMeta | null>(null);

  const iDagDato = new Date().toISOString().slice(0, 10);
  const [aktivtØktId, setAktivtØktId] = useState<string | null>(
    entraObjectId ? `${entraObjectId}-${iDagDato}` : null,
  );

  // Oppdater øktId når entraObjectId lastes
  useEffect(() => {
    if (entraObjectId && !aktivtØktId) {
      setAktivtØktId(`${entraObjectId}-${iDagDato}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entraObjectId]);

  const velgSamtale = useCallback(async (øktId: string) => {
    if (!entraObjectId) return;
    try {
      const res = await apiFetch(`/api/chat/samtaler/${encodeURIComponent(øktId)}`, {
        headers: { 'x-entra-object-id': entraObjectId, ...apiHeaders() },
      });
      if (res.ok) {
        const data = (await res.json()) as { meldinger: ChatMelding[]; rapportId: string | null; rapportNavn: string | null };
        const mapped = (data.meldinger ?? [])
          .filter(m => m.rolle === 'user' || m.rolle === 'assistant')
          .map(m => ({ role: m.rolle, content: m.innhold }));
        setInitialMessages(mapped);
        setAktivSamtaleMeta(data.rapportId ? { rapportId: data.rapportId, rapportNavn: data.rapportNavn } : null);
      }
    } catch {
      setInitialMessages(undefined);
      setAktivSamtaleMeta(null);
    }
    setAktivtØktId(øktId);
    setChatKey(k => k + 1);
  }, [entraObjectId]);

  const nySamtale = useCallback(() => {
    if (!entraObjectId) return;
    const nyId = `${entraObjectId}-${new Date().toISOString()}`;
    setAktivtØktId(nyId);
    setInitialMessages(undefined);
    setAktivSamtaleMeta(null);
    setChatKey(k => k + 1);
  }, [entraObjectId]);

  const åpneRapport = useCallback((rapportId: string, øktId: string | null) => {
    // Persister aktiv økt slik at rapport-AIChat laster riktig samtale
    if (øktId) localStorage.setItem(`aktiv-okt-rapport-${rapportId}`, øktId);
    setÅpen(false);
    router.push(`/dashboard/rapport/${rapportId}`);
  }, [router]);

  // Persist sidebar-valg til localStorage
  useEffect(() => {
    localStorage.setItem('chat-sidebar-synlig', String(sidebarSynlig));
  }, [sidebarSynlig]);

  // Ikke vis widget hvis ikke innlogget eller chat deaktivert
  if (!entraObjectId || !lisens.chatAktivert) return null;

  // ── Knapp (lukket) ──────────────────────────────────────────────────────
  if (!åpen) {
    return (
      <button
        onClick={() => setÅpen(true)}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: 'var(--gold, #f5a623)',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9998,
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          color: 'var(--navy-dark, #0a1628)',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)';
          (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 28px rgba(0,0,0,0.5)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
          (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.4)';
        }}
        title="Åpne AI-assistent"
        aria-label="Åpne AI-assistent"
      >
        <MessageCircle size={22} />
      </button>
    );
  }

  // ── Widget-panel (åpent) ─────────────────────────────────────────────────
  const panelBredd = harSamtalehistorikk && sidebarSynlig
    ? 'min(720px, calc(100vw - 48px))'
    : 'min(480px, calc(100vw - 48px))';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: panelBredd,
        height: 620,
        maxHeight: 'calc(100vh - 48px)',
        background: 'rgba(12,20,38,0.98)',
        border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
        borderRadius: 14,
        boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 9998,
        transition: 'width 0.2s ease',
      }}
    >
      {/* Widget-header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'rgba(10,18,35,0.95)',
          borderBottom: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Sidebar-toggle — kun synlig for beta-brukere */}
          {harSamtalehistorikk && (
            <button
              onClick={() => setSidebarSynlig(v => !v)}
              title={sidebarSynlig ? 'Skjul samtaler' : 'Vis samtaler'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: sidebarSynlig
                  ? 'rgba(245,166,35,0.15)'
                  : 'rgba(255,255,255,0.06)',
                border: sidebarSynlig
                  ? '1px solid rgba(245,166,35,0.4)'
                  : '1px solid rgba(255,255,255,0.12)',
                borderRadius: '6px',
                color: sidebarSynlig ? '#f5a623' : 'rgba(255,255,255,0.65)',
                cursor: 'pointer',
                padding: '5px 9px',
                fontSize: '12px',
                fontWeight: 500,
                transition: 'all 0.15s ease',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span>Samtaler</span>
            </button>
          )}
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: 'var(--glass-gold-bg, rgba(245,166,35,0.12))',
              border: '1px solid var(--glass-gold-border, rgba(245,166,35,0.25))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--gold, #f5a623)',
            }}
          >
            <MessageCircle size={13} />
          </div>
          <span style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: '0.04em',
            color: 'var(--text-primary, #fff)',
          }}>
            AI-assistent
          </span>
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            onClick={() => setÅpen(false)}
            title="Minimer"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted, rgba(255,255,255,0.4))',
              padding: '4px 8px',
              borderRadius: 5,
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary, #fff)'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted, rgba(255,255,255,0.4))'}
          >
            <Minus size={15} />
          </button>
          <button
            onClick={() => { setÅpen(false); }}
            title="Lukk"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted, rgba(255,255,255,0.4))',
              padding: '4px 8px',
              borderRadius: 5,
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = '#e05c5c'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted, rgba(255,255,255,0.4))'}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Innhold: sidebar + chat side om side */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {harSamtalehistorikk && sidebarSynlig && entraObjectId && (
          <SamtaleHistorikkSidebar
            entraObjectId={entraObjectId}
            aktivtØktId={aktivtØktId}
            onVelgSamtale={velgSamtale}
            onNySamtale={nySamtale}
            kompaktMode
          />
        )}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Rapport-banner — vises når aktiv samtale tilhører en rapport */}
          {aktivSamtaleMeta?.rapportId && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', flexShrink: 0,
              background: 'rgba(245,166,35,0.08)',
              borderBottom: '1px solid rgba(245,166,35,0.2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="#f5a623" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="3" y1="9" x2="21" y2="9"/>
                  <line x1="9" y1="21" x2="9" y2="9"/>
                </svg>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {aktivSamtaleMeta.rapportNavn ?? 'Rapport'}
                </span>
              </div>
              <button
                onClick={() => åpneRapport(aktivSamtaleMeta.rapportId, aktivtØktId)}
                style={{
                  background: 'rgba(245,166,35,0.9)', color: '#0a1628',
                  border: 'none', borderRadius: 5, padding: '4px 10px',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0, marginLeft: 8,
                }}
              >
                Åpne rapport →
              </button>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <AIChat
              key={chatKey}
              entraObjectId={entraObjectId}
              grupper={grupper}
              øktId={aktivtØktId ?? undefined}
              harSamtalehistorikk={harSamtalehistorikk}
              standaloneMode
              hideHeader
              initialMessages={initialMessages}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
