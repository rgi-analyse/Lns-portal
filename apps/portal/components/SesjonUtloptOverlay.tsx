'use client';

/**
 * Blokkerende «Sesjonen er utløpt»-overlay for kontrollrom-ruter (sensor-dashbord).
 *
 * Bakgrunn: Skaland kjører et sensor-kontrollrom permanent på en delt, ubemannet
 * 24/7-skjerm. Uten mus/tastatur ser SessionGuard skjermen som inaktiv og logger
 * ut etter ~et døgn. Den vanlige redirecten (/?expired=true…) ga en redirect-løkke
 * som så ut som en frossen skjerm. Dette overlayet gjør tilstanden ærlig og synlig
 * på avstand, i stedet for å redirecte. Kun kontrollrom bruker denne veien — alle
 * andre ruter beholder den vanlige redirecten (se SessionGuard.triggerReLogin).
 *
 * Rendres av AuthProvider, som ligger over hele treet (inkl. sensor-fullskjermsiden
 * på zIndex 60), derfor høy zIndex her. Bruker tenant-tema-variabler (med fallbacks),
 * samme mønster som resten av kontrollrommet — ingen hardkodede farger.
 */

const klokkeFmt = new Intl.DateTimeFormat('nb-NO', {
  timeZone: 'Europe/Oslo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export default function SesjonUtloptOverlay({
  loginUrl,
  tidspunkt,
}: {
  loginUrl: string;
  tidspunkt: Date;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sesjon-utlopt-tittel"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'var(--navy-darkest, #0a1628)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 32,
        gap: 24,
      }}
    >
      <h1
        id="sesjon-utlopt-tittel"
        style={{
          margin: 0,
          color: 'var(--gold, #ffbb00)',
          fontSize: 'clamp(32px, 6vw, 64px)',
          fontWeight: 800,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          lineHeight: 1.1,
        }}
      >
        Sesjonen er utløpt
      </h1>

      <p
        style={{
          margin: 0,
          maxWidth: '32ch',
          color: 'var(--text-primary, #ffffff)',
          fontSize: 'clamp(18px, 2.4vw, 28px)',
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        Dashbordet viser ikke lenger oppdaterte data. Logg inn på nytt for å
        fortsette.
      </p>

      <p
        style={{
          margin: 0,
          color: 'var(--text-secondary, rgba(255,255,255,0.7))',
          fontSize: 'clamp(14px, 1.6vw, 18px)',
          fontWeight: 500,
        }}
      >
        Sesjonen gikk ut {klokkeFmt.format(tidspunkt)} · Europe/Oslo
      </p>

      <button
        type="button"
        onClick={() => {
          window.location.href = loginUrl;
        }}
        style={{
          marginTop: 8,
          padding: '18px 40px',
          fontSize: 'clamp(18px, 2vw, 24px)',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--navy-darkest, #0a1628)',
          background: 'var(--gold, #ffbb00)',
          border: 'none',
          borderRadius: 10,
          cursor: 'pointer',
        }}
      >
        Logg inn på nytt
      </button>
    </div>
  );
}
