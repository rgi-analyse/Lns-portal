interface TilgangEntry {
  entraId: string;
}

/**
 * Sjekker om bruker/grupper har tilgang til en rapport.
 * - Rapport uten egne tilganger → arver workspace-tilgang (return true)
 * - Rapport med egne tilganger → bruker MÅ matche en rad
 */
export function harRapportTilgang(
  brukerId: string,
  grupper: string[],
  rapport: { tilgang: TilgangEntry[] },
): boolean {
  if (rapport.tilgang.length === 0) return true; // arver workspace
  return rapport.tilgang.some(
    (t) => t.entraId === brukerId || grupper.includes(t.entraId),
  );
}

/**
 * Sjekker om bruker/grupper har tilgang til en workspace.
 */
export function harWorkspaceTilgang(
  brukerId: string,
  grupper: string[],
  workspace: { tilgang: TilgangEntry[] },
): boolean {
  return workspace.tilgang.some(
    (t) => t.entraId === brukerId || grupper.includes(t.entraId),
  );
}
