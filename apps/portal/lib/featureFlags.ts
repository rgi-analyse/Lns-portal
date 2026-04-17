/**
 * Feature flags — kontrollerer tilgang til beta-funksjonalitet.
 * Legg til entraObjectId for brukere som skal ha tilgang.
 */

const BETA_BRUKERE: string[] = [
  'bb012447-096e-447f-8d0e-9052caaa0e1a', // Roger
];

export function harBetaTilgang(entraObjectId: string | null | undefined): boolean {
  if (!entraObjectId) return false;
  return BETA_BRUKERE.includes(entraObjectId.trim());
}
