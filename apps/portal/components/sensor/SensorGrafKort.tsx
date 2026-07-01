'use client';

/**
 * Ett graf-kort i kontrollrommet: egen polling-instans + uPlot-graf + valgfri
 * sist-verdi-widget. Rendres N ganger (én per graf i dashbord-konfig).
 */
import dynamic from 'next/dynamic';
import { useSensorPolling } from '@/hooks/useSensorPolling';
import { fargeTekst, type Farge } from './farger';

const SensorGraf = dynamic(() => import('./SensorGraf'), { ssr: false });

const nfmt = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 });

interface Props {
  sensorId: string;
  tittel: string;
  enhet?: string;
  farge: Farge;
  yMin?: number | null;
  yMax?: number | null;
  tidsvinduMin: number;
  intervallSek: number;
  visSisteVerdi: boolean;
  authHeaders: Record<string, string>;
  grupper: string[];
  aktiv: boolean;
}

export default function SensorGrafKort(props: Props) {
  const { data, feil } = useSensorPolling({
    sensorId: props.sensorId,
    intervallSek: props.intervallSek,
    tidsvinduMin: props.tidsvinduMin,
    authHeaders: props.authHeaders,
    grupper: props.grupper,
    aktiv: props.aktiv,
  });

  // Siste ikke-null verdi (til widget).
  let siste: number | null = null;
  if (data) {
    const ys = data[1] as (number | null)[];
    for (let i = ys.length - 1; i >= 0; i--) { if (ys[i] != null) { siste = ys[i] as number; break; } }
  }

  return (
    <div style={{ height: 280, flexShrink: 0, background: 'var(--navy-dark, #1B2A4A)', borderRadius: 10, border: '1px solid var(--glass-bg, rgba(255,255,255,0.06))', padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 12 }}>
        <span style={{ color: 'var(--text-secondary, rgba(255,255,255,0.7))', fontSize: 14, fontWeight: 600 }}>{props.tittel}</span>
        {props.visSisteVerdi && siste != null && (
          <span style={{ color: fargeTekst(props.farge), fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {nfmt.format(siste)}{props.enhet ? ` ${props.enhet}` : ''}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {feil
          ? <p style={{ color: '#f87171', fontSize: 13 }}>Feil: {feil}</p>
          : <SensorGraf data={data ?? [[], []]} navn={props.tittel} enhet={props.enhet} farge={props.farge} yMin={props.yMin} yMax={props.yMax} />}
      </div>
    </div>
  );
}
