'use client';

import { useEffect, useState } from 'react';
import { Rnd } from 'react-rnd';
import dynamic from 'next/dynamic';
import { MessageCircle, Minus } from 'lucide-react';
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
const STORAGE_KEY = 'chat-widget-bounds-v1';

type SnapCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface LagredeBounds {
  width: number;
  height: number;
  snapCorner: SnapCorner;
  erKollapset: boolean;
}

const DEFAULT_BOUNDS: LagredeBounds = {
  width:       DEFAULT_BREDDE,
  height:      DEFAULT_HØYDE,
  snapCorner:  'bottom-right',
  erKollapset: false,
};

function lastBounds(): LagredeBounds {
  if (typeof window === 'undefined') return DEFAULT_BOUNDS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BOUNDS;
    const d = JSON.parse(raw) as Partial<LagredeBounds>;
    const validCorner = (c: unknown): c is SnapCorner =>
      c === 'top-left' || c === 'top-right' || c === 'bottom-left' || c === 'bottom-right';
    if (
      typeof d.width === 'number' && d.width >= MIN_BREDDE &&
      typeof d.height === 'number' && d.height >= MIN_HØYDE &&
      validCorner(d.snapCorner) &&
      typeof d.erKollapset === 'boolean'
    ) {
      return { width: d.width, height: d.height, snapCorner: d.snapCorner, erKollapset: d.erKollapset };
    }
  } catch {
    /* ignorer korrupt storage */
  }
  return DEFAULT_BOUNDS;
}

function lagreBounds(b: LagredeBounds) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    /* ignorer kvote-feil */
  }
}

function nærmesteHjørne(x: number, y: number, w: number, h: number, vw: number, vh: number): SnapCorner {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const top = cy < vh / 2;
  const left = cx < vw / 2;
  if (top && left) return 'top-left';
  if (top) return 'top-right';
  if (left) return 'bottom-left';
  return 'bottom-right';
}

function hjørneTilPosisjon(corner: SnapCorner, vw: number, vh: number, w: number, h: number) {
  switch (corner) {
    case 'top-left':     return { x: MARG, y: MARG };
    case 'top-right':    return { x: Math.max(MARG, vw - w - MARG), y: MARG };
    case 'bottom-left':  return { x: MARG, y: Math.max(MARG, vh - h - MARG) };
    case 'bottom-right': return { x: Math.max(MARG, vw - w - MARG), y: Math.max(MARG, vh - h - MARG) };
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

  // Init med default for å unngå hydration-mismatch — last fra localStorage
  // etter mount.
  const [bounds, setBounds] = useState<LagredeBounds>(DEFAULT_BOUNDS);
  const [hydrert, setHydrert] = useState(false);
  const { width: bredde, height: høyde, snapCorner, erKollapset: kollapset } = bounds;

  const setKollapset = (v: boolean) => setBounds((b) => ({ ...b, erKollapset: v }));

  useEffect(() => {
    setBounds(lastBounds());
    setHydrert(true);
  }, []);

  // Persister hver gang bounds endrer seg (etter mount)
  useEffect(() => {
    if (hydrert) lagreBounds(bounds);
  }, [bounds, hydrert]);

  // Posisjon utledes fra hjørne + viewport — robust mot skjerm-endring
  const position = hjørneTilPosisjon(snapCorner, viewport.w, viewport.h, bredde, høyde);

  const erKompakt = viewport.w < KOMPAKT_GRENSE;

  // Sirkel-knapp når kollapset
  if (kollapset) {
    return (
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
      </button>
    );
  }

  const header = (
    <div
      className={erKompakt ? undefined : DRAG_HANDLE_CLASS}
      style={{
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        background: 'rgba(10,18,35,0.95)',
        borderBottom: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
        cursor: erKompakt ? 'default' : 'move',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <MessageCircle size={14} style={{ color: 'var(--gold, #f5a623)' }} />
        <span
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: '0.04em',
            color: 'var(--text-primary, #fff)',
          }}
        >
          AI-assistent
        </span>
      </div>
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
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary, #fff)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted, rgba(255,255,255,0.4))')}
      >
        <Minus size={15} />
      </button>
    </div>
  );

  const innhold = (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
      <AIChat {...props} standaloneMode hideHeader />
    </div>
  );

  // Kompakt-modus (<1024px): fixed bottom-right, ingen drag/resize
  if (erKompakt) {
    return (
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
      </div>
    );
  }

  // Desktop: Rnd med drag/resize fra alle hjørner og kanter
  return (
    <Rnd
      size={{ width: bredde, height: høyde }}
      position={position}
      bounds="window"
      minWidth={MIN_BREDDE}
      minHeight={MIN_HØYDE}
      dragHandleClassName={DRAG_HANDLE_CLASS}
      onDragStop={(_e, d) => {
        const nyttHjørne = nærmesteHjørne(d.x, d.y, bredde, høyde, viewport.w, viewport.h);
        setBounds((b) => ({ ...b, snapCorner: nyttHjørne }));
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        const nyB = ref.offsetWidth;
        const nyH = ref.offsetHeight;
        const nyttHjørne = nærmesteHjørne(pos.x, pos.y, nyB, nyH, viewport.w, viewport.h);
        setBounds((b) => ({ ...b, width: nyB, height: nyH, snapCorner: nyttHjørne }));
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
  );
}
