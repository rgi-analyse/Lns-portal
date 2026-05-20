'use client';

import ReactMarkdown from 'react-markdown';
import RapportGraf from './RapportGraf';

interface RapportSeksjon {
  id: string;
  tittel?: string;
  rekkefolge?: number;
  type?: string;
}

interface RapportStruktur {
  seksjoner?: RapportSeksjon[];
}

interface Props {
  bestillingId: string;
  authHeaders: Record<string, string>;
  // Parsed sammendrag-JSON fra orchestrator (Steg D/E)
  sammendrag: {
    seksjoner?: Record<string, string>;
    grafer?: Record<string, string>;
  };
  // Parsed rapportStruktur (fra analyseType.rapportStruktur)
  rapportStruktur: RapportStruktur | null;
}

const md = {
  // AI-`#` og AI-`##` → H3 (side-H1 + seksjon-H2 er reservert).
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-lg font-bold mt-4 mb-2" style={{ color: 'var(--navy-dark)' }}>{children}</h3>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-lg font-bold mt-4 mb-2" style={{ color: 'var(--navy-dark)' }}>{children}</h3>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="text-base font-semibold mt-3 mb-2" style={{ color: 'var(--navy-dark)' }}>{children}</h4>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 text-sm leading-relaxed">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-6 mb-2 space-y-1 text-sm">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-6 mb-2 space-y-1 text-sm">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
};

export default function SammendragVisning({
  bestillingId, authHeaders, sammendrag, rapportStruktur,
}: Props) {
  const seksjoner = sammendrag.seksjoner ?? {};
  const grafer = sammendrag.grafer ?? {};

  // Sorter etter rekkefolge fra struktur. Hvis struktur mangler, fall tilbake
  // til id-rekkefølgen i seksjoner (innsettingsorden fra orchestrator).
  const sorterte: RapportSeksjon[] = rapportStruktur?.seksjoner
    ? [...rapportStruktur.seksjoner].sort(
        (a, b) => (a.rekkefolge ?? 999) - (b.rekkefolge ?? 999),
      )
    : Object.keys(seksjoner).map(id => ({ id }));

  return (
    <div className="space-y-6">
      {sorterte.map(seksjon => {
        const tekst = seksjoner[seksjon.id];
        const harGraf = Boolean(grafer[seksjon.id]);
        // Skjul seksjoner som verken har tekst eller graf (defensiv).
        if (!tekst && !harGraf) return null;

        const tittel = seksjon.tittel
          ?? (seksjon.id.charAt(0).toUpperCase() + seksjon.id.slice(1));

        return (
          <section
            key={seksjon.id}
            className="rounded-lg px-4 py-3"
            style={{
              background: 'var(--glass-bg)',
              border:     '1px solid var(--glass-bg-hover)',
              color:      'var(--text-primary)',
            }}
          >
            <h2 className="text-xl font-bold mb-3" style={{ color: 'var(--gold)' }}>
              {tittel}
            </h2>
            {tekst && (
              <ReactMarkdown components={md}>{tekst}</ReactMarkdown>
            )}
            {harGraf && (
              <RapportGraf
                bestillingId={bestillingId}
                seksjonId={seksjon.id}
                authHeaders={authHeaders}
                alt={tittel}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
