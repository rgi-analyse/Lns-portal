'use client';

/**
 * POC-kort (Fase D1) — Azure-stil: 4px radius, elevation via border+bakgrunn
 * (subtil hard skygge, ikke soft blur). Valgfri header/footer.
 */
import { type ReactNode } from 'react';
import { tokens } from '@/lib/design-tokens';

export function Card({ header, footer, children }: { header?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <div
      style={{
        background: tokens.colors.surface.dark,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radii.medium,
        boxShadow: tokens.shadows.elevation1,
        fontFamily: tokens.fontFamily.segoe,
        overflow: 'hidden',
      }}
    >
      {header && (
        <div style={{ padding: `${tokens.spacing[3]} ${tokens.spacing[4]}`, borderBottom: `1px solid ${tokens.colors.border}`, fontSize: tokens.fontSize.h3, fontWeight: tokens.fontWeight.semibold, color: tokens.colors.text.primary }}>
          {header}
        </div>
      )}
      <div style={{ padding: `${tokens.spacing[3]} ${tokens.spacing[4]}`, fontSize: tokens.fontSize.body, color: tokens.colors.text.secondary, lineHeight: tokens.lineHeight.normal }}>
        {children}
      </div>
      {footer && (
        <div style={{ padding: `${tokens.spacing[2]} ${tokens.spacing[4]}`, borderTop: `1px solid ${tokens.colors.border}`, display: 'flex', justifyContent: 'flex-end', gap: tokens.spacing[2] }}>
          {footer}
        </div>
      )}
    </div>
  );
}
