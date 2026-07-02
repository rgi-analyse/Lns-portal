'use client';

/**
 * Delt workspace-ikon (Design-refresh D2 · Gruppe 5).
 * Erstatter den gamle to-bokstavs-initialbadgen. Personlige workspaces
 * ("Mine rapporter", erPersonlig) → Star; alle andre → DataArea. Alltid i
 * tema-farge (var(--gold): gull for LNS, lilla for demo).
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
  return <Ikon style={{ color: 'var(--gold)', fontSize: size, width: size, height: size, ...style }} />;
}
