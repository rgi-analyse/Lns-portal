'use client';

/**
 * POC-knapp (Fase D1) — Microsoft/Azure-stil: Segoe, kompakt padding, 2px radius,
 * ingen soft-shadow. Ikon-agnostisk (send Fluent-ikon via `ikon`).
 */
import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { tokens } from '@/lib/design-tokens';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  ikon?: ReactNode;
}

export function Button({ variant = 'primary', ikon, children, style, ...rest }: Props) {
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: tokens.spacing[2],
    fontFamily: tokens.fontFamily.segoe,
    fontSize: tokens.fontSize.body,
    fontWeight: tokens.fontWeight.semibold,
    lineHeight: 1,
    padding: '7px 14px',
    borderRadius: tokens.radii.small,
    border: '1px solid transparent',
    cursor: 'pointer',
    transition: `all ${tokens.transitions.duration.fast} ${tokens.transitions.easing}`,
  };
  const variantStil: CSSProperties = variant === 'primary'
    ? { background: tokens.colors.brand.primary, color: tokens.colors.brand.primaryText, borderColor: tokens.colors.brand.primary }
    : { background: 'transparent', color: tokens.colors.text.primary, borderColor: tokens.colors.border };

  return (
    <button style={{ ...base, ...variantStil, ...style }} {...rest}>
      {ikon}
      {children}
    </button>
  );
}
