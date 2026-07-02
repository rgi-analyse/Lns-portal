'use client';

/**
 * Delt workspace-ikon (Design-refresh D2 · Gruppe 5).
 * Erstatter den gamle to-bokstavs-initialbadgen. Personlige workspaces
 * ("Mine rapporter", erPersonlig) → Star; alle andre → DataArea. Nøytral
 * tekstfarge (ikonet er et grafisk element, ikke tema-highlight — tema-fargen
 * reserveres for aktive tilstander, fokus, primary-knapper og brand).
 */
import { type CSSProperties } from 'react';
import { Star24Regular, DataArea24Regular } from '@fluentui/react-icons';

export function WorkspaceIkon({
  personlig = false,
  size = 24,
  style,
}: {
  personlig?: boolean;
  size?: number;
  style?: CSSProperties;
}) {
  const Ikon = personlig ? Star24Regular : DataArea24Regular;
  return <Ikon style={{ color: 'var(--text-secondary)', fontSize: size, width: size, height: size, ...style }} />;
}
