'use client';

export interface TabellRad {
  label:           string;
  belop:           number;
  pluss?:          boolean;
  uthevet?:        boolean;
  skillelinjeFor?: boolean;
}

export interface TabellData {
  rader: TabellRad[];
}

/**
 * Norsk tallformat: 2 desimaler, mellomrom som tusenskille (Intl gir nbsp),
 * komma som desimal, en-dash (U+2212) som typografisk minus for negative
 * tall. Inntekt-raden får eksplisitt + når pluss=true.
 */
function formaterBelop(n: number, pluss?: boolean): string {
  const abs = Math.abs(n).toLocaleString('nb-NO', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  if (n < 0) return `−${abs}`;
  if (pluss && n > 0) return `+${abs}`;
  return abs;
}

export default function ResultatTabell({ data }: { data: TabellData }) {
  return (
    <table className="w-full mt-3 text-sm" style={{ color: 'var(--text-primary)' }}>
      <tbody>
        {data.rader.map((rad, idx) => {
          const skille = rad.skillelinjeFor
            ? { borderTop: '1px solid var(--navy-dark)' }
            : undefined;
          const cellStyle = {
            ...(skille ?? {}),
            padding: '6px 8px',
            fontWeight: rad.uthevet ? 600 : 400,
          };
          return (
            <tr key={idx}>
              <td style={cellStyle}>{rad.label}</td>
              <td
                style={{
                  ...cellStyle,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {formaterBelop(rad.belop, rad.pluss)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
