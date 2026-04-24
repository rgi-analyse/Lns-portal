import * as Icons from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';

interface Props extends LucideProps {
  navn?:     string | null;
  fallback?: keyof typeof Icons;
}

// Icons-namespacet inneholder også ikke-ikon-utilities (createLucideIcon, LucideIcon, …).
// Vi caster til et lookup-map — AnalyseType.ikon er fri-form string fra DB, så ugyldige
// verdier må falle tilbake til fallback-ikonet.
const icons = Icons as unknown as Record<string, LucideIcon | undefined>;

export function AnalyseIkon({ navn, fallback = 'FileText', ...rest }: Props) {
  const IconKomponent = (navn ? icons[navn] : undefined) ?? icons[fallback] ?? Icons.FileText;
  return <IconKomponent {...rest} />;
}
