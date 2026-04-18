/**
 * Genererer deterministisk øktId for rapport-spesifikke chat-samtaler.
 * Format: rapport-<rapportId>-bruker-<entraObjectId>
 *
 * En rapport-økt er knyttet til én rapport + én bruker for alltid (ikke dato-basert),
 * slik at historikken bevares på tvers av dager.
 */
export function genererRapportØktId(brukerEntraId: string, rapportId: string): string {
  return `rapport-${rapportId}-bruker-${brukerEntraId}`;
}

/**
 * Genererer daglig global øktId (brukes i ChatWidget uten rapport-kontekst).
 * Format: <entraObjectId>-<YYYY-MM-DD>
 */
export function genererGlobalØktId(brukerEntraId: string, dato?: Date): string {
  const d = dato ?? new Date();
  const datoStr = d.toISOString().slice(0, 10);
  return `${brukerEntraId}-${datoStr}`;
}
