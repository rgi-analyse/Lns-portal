import * as React from 'react';
import * as Ikoner from '@/components/ikoner';

interface Props extends React.SVGProps<SVGSVGElement> {
  navn?:     string | null;
  fallback?: keyof typeof Ikoner;
  size?:     number | string;
}

// Ikon-adapteret (D2 Gruppe 4) eksporterer Fluent-ikoner under Lucide-navn.
// AnalyseType.ikon er fri-form (Lucide-navn lagret i DB), så ugyldige/ukjente
// navn faller tilbake til fallback-ikonet. Ikon-navn som ikke finnes i adapteret
// vises som fallback — utvid adapteret ved behov.
const ikoner = Ikoner as unknown as Record<
  string,
  React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number | string }> | undefined
>;

export function AnalyseIkon({ navn, fallback = 'FileText', ...rest }: Props) {
  const IconKomponent = (navn ? ikoner[navn] : undefined) ?? ikoner[fallback] ?? Ikoner.FileText;
  return <IconKomponent {...rest} />;
}
