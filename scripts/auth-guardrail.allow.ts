/**
 * Allowlist for auth-guardrail (scripts/auth-guardrail.ts).
 *
 * Kun for BEVISSTE unntak: kall som guardrailen flagger, men som er trygge —
 * f.eks. der auth-deteksjonen gir falsk negativ, eller et endepunkt matcher
 * en beskyttet rute ved et uhell. HVER oppføring KREVER en begrunnelse og
 * vurderes i PR. Tom liste = ingen unntak (foretrukket).
 *
 * `fil`       — sti-suffiks som identifiserer kall-filen (f.eks. 'components/X.tsx')
 * `endepunkt` — normalisert '/api/...'-endepunkt, eller '*' for alle i filen
 * `reason`    — hvorfor dette er trygt uten auth-header (obligatorisk)
 */
export type Allow = {
  endepunkt: string;
  fil: string;
  reason: string;
};

export const ALLOW: Allow[] = [
  // Eksempel (ikke aktiv):
  // { fil: 'components/Foo.tsx', endepunkt: '/api/foo', reason: 'Leser auth via egen SDK, ikke header.' },
];
