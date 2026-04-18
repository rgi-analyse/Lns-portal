export function hentHilsen(): string {
  const t = new Date().getHours();
  if (t >= 5 && t < 10) return 'God morgen';
  if (t >= 10 && t < 16) return 'Hei';
  if (t >= 16 && t < 22) return 'God kveld';
  return 'Hei';
}

export function hentFornavn(fulltNavn: string | undefined | null): string {
  if (!fulltNavn) return '';
  return fulltNavn.trim().split(/\s+/)[0] ?? '';
}

export function byggRapportVelkomst(
  fulltNavn: string | undefined | null,
  rapportNavn: string | undefined | null,
): string {
  const hilsen = hentHilsen();
  const fornavn = hentFornavn(fulltNavn);
  const rapport = rapportNavn ?? 'denne rapporten';

  const hilsenDel = fornavn ? `${hilsen} ${fornavn}!` : `${hilsen}!`;
  return `${hilsenDel} Du ser nå på **${rapport}**. Hva vil du vite?`;
}
