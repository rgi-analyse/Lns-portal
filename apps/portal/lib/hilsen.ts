export function hentHilsen(): string {
  const t = new Date().getHours();
  if (t >= 5 && t < 10) return 'God morgen';
  if (t >= 10 && t < 15) return 'Hei';
  if (t >= 15 && t < 18) return 'God ettermiddag';
  if (t >= 18 && t < 22) return 'God kveld';
  return 'Hei'; // natt (22-05)
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
