'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import dynamic from 'next/dynamic';
import { MessageCircle, MessagesSquare, Minus } from 'lucide-react';
import type AIChatComponent from '@/components/AIChat';

const AIChat = dynamic(() => import('@/components/AIChat'), { ssr: false });

type AIChatProps = React.ComponentProps<typeof AIChatComponent>;
type FlytendeChatWrapperProps = Omit<AIChatProps, 'standaloneMode' | 'hideHeader'>;

const DRAG_HANDLE_CLASS = 'flytende-chat-drag-handle';
const DEFAULT_BREDDE = 480;
const DEFAULT_HØYDE = 620;
const MIN_BREDDE = 320;
const MIN_HØYDE = 400;
const MARG = 24;
const KOMPAKT_GRENSE = 1024;
const STORAGE_KEY_V1 = 'chat-widget-bounds-v1';  // gammel, slettes etter migration
const STORAGE_KEY = 'chat-widget-bounds-v2';
// Bredde av historikk-sidebar inni AIChat når kompaktMode er aktiv. Verifisert
// mot SamtaleHistorikkSidebar.tsx:143 (width: '220px' i kompaktMode).
const SIDEBAR_WIDTH = 220;

interface LagredeBounds {
  width: number;
  height: number;
  x: number;
  y: number;
  erKollapset: boolean;
}

// Konstant default for SSR (klient overskriver i useEffect basert på faktisk
// viewport). x/y er valgt så den ligner den klassiske bottom-right-plasseringen
// på en typisk desktop.
const SSR_DEFAULT_BOUNDS: LagredeBounds = {
  width:       DEFAULT_BREDDE,
  height:      DEFAULT_HØYDE,
  x:           1920 - DEFAULT_BREDDE - MARG,
  y:           1080 - DEFAULT_HØYDE - MARG,
  erKollapset: false,
};

function defaultBoundsForViewport(vw: number, vh: number): LagredeBounds {
  return {
    width:       DEFAULT_BREDDE,
    height:      DEFAULT_HØYDE,
    x:           Math.max(MARG, vw - DEFAULT_BREDDE - MARG),
    y:           Math.max(MARG, vh - DEFAULT_HØYDE - MARG),
    erKollapset: false,
  };
}

function migrerV1TilV2(): LagredeBounds | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY_V1);
  if (!raw) return null;
  try {
    const v1 = JSON.parse(raw) as { width?: unknown; height?: unknown; snapCorner?: unknown; erKollapset?: unknown };
    if (
      typeof v1.width !== 'number' || v1.width < MIN_BREDDE ||
      typeof v1.height !== 'number' || v1.height < MIN_HØYDE ||
      typeof v1.erKollapset !== 'boolean'
    ) return null;
    const w = v1.width;
    const h = v1.height;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = Math.max(MARG, vw - w - MARG);
    let y = Math.max(MARG, vh - h - MARG);
    switch (v1.snapCorner) {
      case 'top-left':     x = MARG;                          y = MARG;                          break;
      case 'top-right':    x = Math.max(MARG, vw - w - MARG); y = MARG;                          break;
      case 'bottom-left':  x = MARG;                          y = Math.max(MARG, vh - h - MARG); break;
      case 'bottom-right': x = Math.max(MARG, vw - w - MARG); y = Math.max(MARG, vh - h - MARG); break;
      default: /* ukjent corner — bruk default */ break;
    }
    return { width: w, height: h, x, y, erKollapset: v1.erKollapset };
  } catch {
    return null;
  }
}

function lastBounds(): LagredeBounds {
  if (typeof window === 'undefined') return SSR_DEFAULT_BOUNDS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<LagredeBounds>;
      if (
        typeof d.width === 'number'  && d.width  >= MIN_BREDDE &&
        typeof d.height === 'number' && d.height >= MIN_HØYDE  &&
        typeof d.x === 'number'      &&
        typeof d.y === 'number'      &&
        typeof d.erKollapset === 'boolean'
      ) {
        return { width: d.width, height: d.height, x: d.x, y: d.y, erKollapset: d.erKollapset };
      }
    }
  } catch {
    /* ignorer korrupt v2-storage — fall gjennom til v1-migration */
  }
  // v2 manglet eller var ugyldig — prøv migration fra v1
  const migrert = migrerV1TilV2();
  if (migrert) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrert));
      localStorage.removeItem(STORAGE_KEY_V1);
    } catch { /* ignorer */ }
    return migrert;
  }
  return defaultBoundsForViewport(window.innerWidth, window.innerHeight);
}

/**
 * Klamper x/y slik at minst min(w, 100) px av bredden og min(h, 50) px av
 * høyden alltid er innenfor viewport. Hindrer at widget havner utilgjengelig
 * off-screen ved skjerm-resize, eller hvis lagret pos er ugyldig.
 */
function validerPosisjon(x: number, y: number, w: number, h: number, vw: number, vh: number) {
  const maxX = vw - Math.min(w, 100);
  const maxY = vh - Math.min(h, 50);
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  };
}

function lagreBounds(b: LagredeBounds) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    /* ignorer kvote-feil */
  }
}

function useViewport() {
  const [size, setSize] = useState(() =>
    typeof window === 'undefined'
      ? { w: 1920, h: 1080 }
      : { w: window.innerWidth, h: window.innerHeight },
  );
  useEffect(() => {
    const handler = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return size;
}

export default function FlytendeChatWrapper(props: FlytendeChatWrapperProps) {
  const viewport = useViewport();

  // Init med SSR-default — last faktisk lagret bounds (med v1-migration) i
  // useEffect for å unngå hydration-mismatch.
  const [bounds, setBounds] = useState<LagredeBounds>(SSR_DEFAULT_BOUNDS);
  const [hydrert, setHydrert] = useState(false);
  // Sett til true etter mount så vi trygt kan bruke document.body i portalen.
  const [montert, setMontert] = useState(false);
  // Aktiv drag/resize — vis overlay over PowerBI-iframe så mouse-events
  // ikke spises av iframen.
  const [drar, setDrar] = useState(false);
  // Bredde widget hadde rett før sidebar ble åpnet — brukt til å restaurere
  // ved lukking. null betyr "sidebar er ikke åpnet av oss" (initial state
  // eller sidebar var allerede åpen ved mount).
  const [widthBeforeSidebar, setWidthBeforeSidebar] = useState<number | null>(null);
  const { width: bredde, height: høyde, x: posX, y: posY, erKollapset: kollapset } = bounds;

  const setKollapset = (v: boolean) => setBounds((b) => ({ ...b, erKollapset: v }));

  useEffect(() => {
    setBounds(lastBounds());
    setHydrert(true);
    setMontert(true);
  }, []);

  // Klamp posisjon hvis viewport endrer seg slik at widget ville havnet
  // off-screen. Kjøres også første render etter hydration.
  useEffect(() => {
    if (!hydrert) return;
    setBounds((b) => {
      const v = validerPosisjon(b.x, b.y, b.width, b.height, viewport.w, viewport.h);
      if (v.x === b.x && v.y === b.y) return b;
      return { ...b, x: v.x, y: v.y };
    });
  }, [viewport.w, viewport.h, hydrert]);

  // Persister hver gang bounds endrer seg (etter mount)
  useEffect(() => {
    if (hydrert) lagreBounds(bounds);
  }, [bounds, hydrert]);

  const erKompakt = viewport.w < KOMPAKT_GRENSE;

  // Eksponer historikk-toggle i wrapper-header når brukeren har samtale-
  // historikk aktivert. AIChat sin egen toggle ligger i AIChat-header som
  // er skjult via hideHeader, så uten denne ville bruker miste tilgangen.
  const harHistorikk = !!props.harSamtalehistorikk;
  const sidebarSynlig = !!props.sidebarSynlig;

  // Auto-utvid widget når sidebar åpnes, krymp tilbake ved lukking.
  // Bruker forrigeSidebarSynlig-ref for å detektere overgang fra/til false.
  // Ved første mount (ref === undefined) registreres bare gjeldende verdi
  // uten å trigge bredde-endring — dette dekker tilfellet hvor sidebar var
  // åpen ved forrige session og widget allerede er stor nok.
  const forrigeSidebarSynlig = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!hydrert) return;
    const gammel = forrigeSidebarSynlig.current;
    forrigeSidebarSynlig.current = sidebarSynlig;
    if (gammel === undefined || gammel === sidebarSynlig) return;

    if (sidebarSynlig) {
      // Åpnet: lagre nåværende bredde, utvid med SIDEBAR_WIDTH (klampt mot
      // tilgjengelig viewport-bredde fra widget.x til høyre kant).
      setWidthBeforeSidebar(bredde);
      const maxBredde = Math.max(MIN_BREDDE, viewport.w - posX - MARG);
      const nyBredde  = Math.min(bredde + SIDEBAR_WIDTH, maxBredde);
      if (nyBredde !== bredde) {
        setBounds((b) => ({ ...b, width: nyBredde }));
      }
    } else {
      // Lukket: restaurer til widthBeforeSidebar hvis vi husker den.
      if (widthBeforeSidebar !== null) {
        const restore = widthBeforeSidebar;
        setWidthBeforeSidebar(null);
        setBounds((b) => ({ ...b, width: restore }));
      }
    }
    // bredde/posX leses ved trigger, men vi vil ikke kjøre effekten på hver
    // bounds-endring — derfor er de ikke i deps. Logikken er styrt av at
    // sidebarSynlig faktisk endrer seg.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarSynlig, hydrert]);
  const onToggleSidebar = props.onToggleSidebar;
  const visHistorikkKnapp = harHistorikk && !!onToggleSidebar;

  // Wrapper ALL rendering i React Portal til document.body. Uten dette ville
  // widget visuelt vært klippet av container med overflow:hidden i rapport-
  // page eller dashboard-layout, og kunne ikke plasseres over header eller
  // sidemeny. Returnerer null før mount for å unngå SSR/hydration-issues.
  const tilPortal = (jsx: React.ReactNode): React.ReactNode => {
    if (!montert || typeof document === 'undefined') return null;
    return createPortal(jsx, document.body);
  };

  // Sirkel-knapp når kollapset
  if (kollapset) {
    return tilPortal(
      <button
        onClick={() => setKollapset(false)}
        title="Åpne AI-assistent"
        aria-label="Åpne AI-assistent"
        style={{
          position: 'fixed',
          bottom: MARG,
          right: MARG,
          width: 60,
          height: 60,
          borderRadius: '50%',
          background: 'var(--gold, #f5a623)',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9998,
          color: 'var(--navy-dark, #0a1628)',
        }}
      >
        <MessageCircle size={24} />
      </button>,
    );
  }

  const header = (
    <div
      style={{
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        background: 'rgba(10,18,35,0.95)',
        borderBottom: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Drag-handle: kun tittel-delen — knapper får ikke denne klassen
          så klikk på dem ikke tolkes som drag-start. */}
      <div
        className={erKompakt ? undefined : DRAG_HANDLE_CLASS}
        style={{
          display:    'flex',
          alignItems: 'center',
          gap:        8,
          flex:       1,
          minWidth:   0,
          height:     '100%',
          cursor:     erKompakt ? 'default' : 'move',
        }}
      >
        <MessageCircle size={14} style={{ color: 'var(--gold, #f5a623)', flexShrink: 0 }} />
        <span
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: '0.04em',
            color: 'var(--text-primary, #fff)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          AI-assistent
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {visHistorikkKnapp && (
          <button
            onClick={() => onToggleSidebar?.(!sidebarSynlig)}
            title={sidebarSynlig ? 'Skjul samtaler' : 'Vis samtaler'}
            style={{
              background: sidebarSynlig
                ? 'rgba(245,166,35,0.15)'
                : 'rgba(255,255,255,0.06)',
              border: sidebarSynlig
                ? '1px solid rgba(245,166,35,0.4)'
                : '1px solid rgba(255,255,255,0.12)',
              borderRadius: 5,
              color: sidebarSynlig ? '#f5a623' : 'rgba(255,255,255,0.65)',
              cursor: 'pointer',
              padding: '4px 7px',
              display: 'flex',
              alignItems: 'center',
              transition: 'all 0.15s ease',
              // Sikrer at klikket lander på knappen, ikke en evt. drag-
              // handle eller resize-håndtak som ligger over.
              position: 'relative',
              zIndex: 10,
            }}
          >
            <MessagesSquare size={13} />
          </button>
        )}
        <button
          onClick={() => setKollapset(true)}
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
            position: 'relative',
            zIndex: 10,
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary, #fff)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted, rgba(255,255,255,0.4))')}
        >
          <Minus size={15} />
        </button>
      </div>
    </div>
  );

  const innhold = (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
      <AIChat {...props} standaloneMode hideHeader />
    </div>
  );

  // Kompakt-modus (<1024px): fixed bottom-right, ingen drag/resize
  if (erKompakt) {
    return tilPortal(
      <div
        style={{
          position: 'fixed',
          bottom: MARG,
          right: MARG,
          width: `min(${DEFAULT_BREDDE}px, calc(100vw - 48px))`,
          height: `min(${DEFAULT_HØYDE}px, calc(100vh - 48px))`,
          background: 'rgba(12,20,38,0.98)',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
          borderRadius: 14,
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 9998,
        }}
      >
        {header}
        {innhold}
      </div>,
    );
  }

  // Desktop: Rnd med drag/resize fra alle hjørner og kanter
  return tilPortal(
    <>
      {drar && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9997,
            cursor: 'move',
            background: 'transparent',
          }}
        />
      )}
      <Rnd
        size={{ width: bredde, height: høyde }}
        position={{ x: posX, y: posY }}
        bounds="window"
        minWidth={MIN_BREDDE}
        minHeight={MIN_HØYDE}
        dragHandleClassName={DRAG_HANDLE_CLASS}
        onDragStart={() => setDrar(true)}
        onResizeStart={() => setDrar(true)}
        onDragStop={(_e, d) => {
          setDrar(false);
          // Fri plassering — lagre eksakt drop-posisjon, ingen snap.
          setBounds((b) => ({ ...b, x: d.x, y: d.y }));
        }}
        onResizeStop={(_e, _dir, ref, _delta, pos) => {
          setDrar(false);
          const nyBredde = ref.offsetWidth;
          setBounds((b) => ({
            ...b,
            width:  nyBredde,
            height: ref.offsetHeight,
            x:      pos.x,
            y:      pos.y,
          }));
          // Hvis sidebar er åpen og bruker resizet manuelt: oppdater hva som
          // restaureres ved lukking, slik at chat-delen beholder ny bredde
          // (target-bredde minus sidebar).
          if (sidebarSynlig && widthBeforeSidebar !== null) {
            setWidthBeforeSidebar(Math.max(MIN_BREDDE, nyBredde - SIDEBAR_WIDTH));
          }
        }}
        style={{
          background: 'rgba(12,20,38,0.98)',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
          borderRadius: 14,
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 9998,
        }}
      >
        {header}
        {innhold}
      </Rnd>
    </>,
  );
}
