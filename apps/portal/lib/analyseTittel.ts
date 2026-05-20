/**
 * Bygger visnings-tittel for en analyse-bestilling.
 * Bruker brukerens egne tittel hvis satt (POST /bestillinger lagrer den).
 * Hvis null/tom: fall tilbake til analyseType.navn + valgfri prosjekt-del.
 *
 * Workeren skriver IKKE til tittel-feltet (etter fiks i orchestrator.ts),
 * så brukerens valg bevares gjennom hele livssyklusen.
 */
export function bygTittel(
  tittel: string | null | undefined,
  analyseTypeNavn: string,
  parametre: Record<string, unknown> | null | undefined,
): string {
  if (tittel && tittel.trim().length > 0) return tittel;

  const deler: string[] = [analyseTypeNavn];
  const prosjekt = parametre?.prosjekt;
  if (typeof prosjekt === 'string' && prosjekt.trim().length > 0) {
    deler.push(`Prosjekt ${prosjekt}`);
  }
  return deler.join(' · ');
}
