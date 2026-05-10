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

function defaultPosition(viewportW: number, viewportH: number, w: number, h: number) {
  return {
    x: Math.max(MARG, viewportW - w - MARG),
    y: Math.max(MARG, viewportH - h - MARG),
  };
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
  const [kollapset, setKollapset] = useState(false);
  const [bredde, setBredde] = useState(DEFAULT_BREDDE);
  const [høyde, setHøyde] = useState(DEFAULT_HØYDE);
  const [position, setPosition] = useState(() =>
    defaultPosition(viewport.w, viewport.h, DEFAULT_BREDDE, DEFAULT_HØYDE),
  );

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
      onDragStop={(_e, d) => setPosition({ x: d.x, y: d.y })}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        setBredde(ref.offsetWidth);
        setHøyde(ref.offsetHeight);
        setPosition(pos);
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
