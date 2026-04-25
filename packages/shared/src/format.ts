/**
 * Formaterer et beløp som norske kroner uten desimaler.
 * Eksempel: formatNok(1234567) → "kr 1 234 567"
 */
export function formatNok(belop: number): string {
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency: 'NOK',
    maximumFractionDigits: 0,
  }).format(belop);
}

/**
 * Formaterer en Date eller ISO-string som norsk dato (dag. måned år).
 * Returnerer '—' ved ugyldig input.
 */
export function formatDato(dato: Date | string | null | undefined): string {
  if (!dato) return '—';
  const d = typeof dato === 'string' ? new Date(dato) : dato;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('nb-NO', {
    day:      'numeric',
    month:    'short',
    year:     'numeric',
    timeZone: 'Europe/Oslo',
  });
}

/**
 * Formaterer et årmåned-heltall (f.eks. 202604) som lesbar måned/år.
 * Eksempel: formatAarmaaned(202604) → "april 2026"
 */
export function formatAarmaaned(aarmaaned: number): string {
  const aar = Math.trunc(aarmaaned / 100);
  const mnd = aarmaaned % 100;
  if (aar < 1900 || aar > 2100 || mnd < 1 || mnd > 12) return String(aarmaaned);
  const navn = ['januar', 'februar', 'mars', 'april', 'mai', 'juni',
                'juli', 'august', 'september', 'oktober', 'november', 'desember'];
  return `${navn[mnd - 1]} ${aar}`;
}
