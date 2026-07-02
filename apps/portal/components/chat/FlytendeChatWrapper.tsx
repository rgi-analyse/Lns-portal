'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import dynamic from 'next/dynamic';
import { GripHorizontal, MessageCircle } from '@/components/ikoner';
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
  // Bredde og x widget hadde rett før sidebar ble åpnet — brukt til å
  // restaurere ved lukking. null betyr "sidebar er ikke åpnet av oss" (initial
  // state eller sidebar var allerede åpen ved mount).
  const [widthBeforeSidebar, setWidthBeforeSidebar] = useState<number | null>(null);
  const [xBeforeSidebar,     setXBeforeSidebar]     = useState<number | null>(null);
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

  // Sidebar-synlighet kommer fra parent (rapport-page). AIChats native header
  // har sin egen Samtaler-toggle som bruker onToggleSidebar — vi eksponerer
  // den derfor IKKE i wrapperen for å unngå duplikat.
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
      // Åpnet: chat-delen er anker — sidebar legger seg til VENSTRE for chat,
      // så høyre kant skal forbli stille. Det betyr at x flyttes til venstre
      // med SIDEBAR_WIDTH og width øker tilsvarende.
      //
      // Hvis x ikke kan flyttes så langt mot venstre (allerede nær venstre
      // kant), klampes x til 0 og widget utvider seg det den kan mot høyre
      // i stedet — i så fall vil chat-delen visuelt bevege seg mot høyre.
      setWidthBeforeSidebar(bredde);
      setXBeforeSidebar(posX);

      const desiredX = posX - SIDEBAR_WIDTH;
      const clampedX = Math.max(0, desiredX);
      const maxBredde = Math.max(MIN_BREDDE, viewport.w - clampedX - MARG);
      const nyBredde  = Math.min(bredde + SIDEBAR_WIDTH, maxBredde);

      if (clampedX !== posX || nyBredde !== bredde) {
        setBounds((b) => ({ ...b, x: clampedX, width: nyBredde }));
      }
    } else {
      // Lukket: restaurer både x og width til verdiene fra før åpning.
      if (widthBeforeSidebar !== null && xBeforeSidebar !== null) {
        const restoreW = widthBeforeSidebar;
        const restoreX = xBeforeSidebar;
        setWidthBeforeSidebar(null);
        setXBeforeSidebar(null);
        setBounds((b) => ({ ...b, x: restoreX, width: restoreW }));
      }
    }
    // bredde/posX leses ved trigger, men vi vil ikke kjøre effekten på hver
    // bounds-endring — derfor er de ikke i deps. Logikken er styrt av at
    // sidebarSynlig faktisk endrer seg.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarSynlig, hydrert]);

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
          color: 'var(--primary-text)',
        }}
      >
        <MessageCircle size={24} />
      </button>,
    );
  }

  // Tynn drag-stripe over AIChats native header. AIChat selv har Samtaler-
  // toggle, organisasjonsnavn-tittel, TTS-knapper og X-knapp (sistnevnte
  // kollapser widget via onClose-callback). Wrapper-stripen er kun drag-
  // handle.
  const header = (
    <div
      className={erKompakt ? undefined : DRAG_HANDLE_CLASS}
      title={erKompakt ? undefined : 'Dra for å flytte'}
      style={{
        height: 14,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10,18,35,0.95)',
        borderBottom: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
        userSelect: 'none',
        flexShrink: 0,
        cursor: erKompakt ? 'default' : 'move',
        color: 'rgba(255,255,255,0.25)',
      }}
    >
      <GripHorizontal size={12} />
    </div>
  );

  // AIChats native header rendres med Samtaler-toggle, organisasjonsnavn,
  // TTS-knapper og X. standaloneMode={true} embedder AIChat i vår container.
  // onClose kobler AIChats X-knapp til kollaps — widget krymper til sirkel-
  // ikon, state bevares (komponenten unmounteres ikke).
  const innhold = (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
      <AIChat
        {...props}
        standaloneMode={true}
        onClose={() => setKollapset(true)}
      />
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
          borderRadius: 8,
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
          // Hvis sidebar er åpen, oppdater xBeforeSidebar slik at lukking
          // legger chat-delens høyre kant der den nå står
          // (uten-sidebar x = nåværende x + SIDEBAR_WIDTH).
          if (sidebarSynlig && xBeforeSidebar !== null) {
            setXBeforeSidebar(d.x + SIDEBAR_WIDTH);
          }
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
          // Hvis sidebar er åpen: oppdater hva som restaureres ved lukking,
          // slik at chat-delen beholder sin nye bredde og posisjon.
          if (sidebarSynlig && widthBeforeSidebar !== null && xBeforeSidebar !== null) {
            setWidthBeforeSidebar(Math.max(MIN_BREDDE, nyBredde - SIDEBAR_WIDTH));
            setXBeforeSidebar(pos.x + SIDEBAR_WIDTH);
          }
        }}
        style={{
          background: 'rgba(12,20,38,0.98)',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
          borderRadius: 8,
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
