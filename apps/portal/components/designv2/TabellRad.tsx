'use client';

/**
 * POC-tabellrad (Fase D1) — kompakt Azure-tetthet: 13px Segoe, tette rader,
 * uppercase-header i muted-farge, tynn radskille.
 */
import { type ReactNode, type CSSProperties } from 'react';
import { tokens } from '@/lib/design-tokens';

export function TabellRad({ celler, header = false }: { celler: ReactNode[]; header?: boolean }) {
  const celle: CSSProperties = {
    padding: header ? '7px 12px' : '5px 12px',
    fontFamily: tokens.fontFamily.segoe,
    fontSize: header ? tokens.fontSize.small : tokens.fontSize.tabell,
    fontWeight: header ? tokens.fontWeight.semibold : tokens.fontWeight.regular,
    color: header ? tokens.colors.text.muted : tokens.colors.text.secondary,
    textAlign: 'left',
    textTransform: header ? 'uppercase' : 'none',
    letterSpacing: header ? '0.04em' : 'normal',
    borderBottom: `1px solid var(--glass-bg, rgba(255,255,255,0.06))`,
    whiteSpace: 'nowrap',
  };
  return (
    <tr>
      {celler.map((c, i) =>
        header
          ? <th key={i} style={celle}>{c}</th>
          : <td key={i} style={celle}>{c}</td>,
      )}
    </tr>
  );
}
