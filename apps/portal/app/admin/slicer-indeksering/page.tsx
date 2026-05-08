'use client';

/**
 * Admin-side: oversikt over slicer-indeks-konfigurasjoner.
 * Bruker glassmorphic dark-stil — matcher /admin/page.tsx (admin overview).
 *
 * NB: Dette er skall-versjonen — fyllemulighet legges til i påfølgende commit.
 */

export default function SlicerIndekseringPage() {
  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1
          className="uppercase tracking-wide"
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 800,
            fontSize: 24,
            color: 'var(--text-primary)',
          }}
        >
          Slicer-indeksering
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Administrer hvilke slicer-verdier som indekseres i Azure AI Search for AI-assistert filter-hjelp.
        </p>
      </div>

      <div
        className="rounded-2xl p-6 text-sm"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid var(--glass-bg-hover)',
          color: 'var(--text-muted)',
        }}
      >
        Innhold kommer i neste commit.
      </div>
    </div>
  );
}
