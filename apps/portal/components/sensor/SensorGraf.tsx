'use client';

/**
 * uPlot-wrapper for sensor-tidsserie. Klient-only (uPlot rører canvas/DOM) —
 * importeres via next/dynamic med ssr:false fra siden.
 *
 * Steg 4a: uPlot-defaults på hvit graf-flate (les-og-tegn-verifisering).
 * Full tema-integrering (gull-linje på navy, CSS-variabler, tzDate) kommer i 4b.
 */
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface Props {
  data: uPlot.AlignedData;   // [tidspunkter(sek), verdier]
  navn: string;
  enhet?: string;
}

export default function SensorGraf({ data, navn, enhet }: Props) {
  const boks = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  // Opprett uPlot-instansen én gang.
  useEffect(() => {
    const el = boks.current;
    if (!el) return;
    const opts: uPlot.Options = {
      width: el.clientWidth || 800,
      height: el.clientHeight || 400,
      scales: { x: { time: true } },
      series: [
        {},
        { label: `${navn}${enhet ? ` (${enhet})` : ''}`, stroke: '#1B2A4A', width: 1.5 },
      ],
    };
    const u = new uPlot(opts, data, el);
    plot.current = u;
    return () => { u.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Oppdater data uten å re-opprette instansen.
  useEffect(() => { plot.current?.setData(data); }, [data]);

  // Hold størrelsen i sync med containeren.
  useEffect(() => {
    const el = boks.current;
    const onResize = () => {
      if (el && plot.current) plot.current.setSize({ width: el.clientWidth, height: el.clientHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return <div ref={boks} style={{ width: '100%', height: '100%' }} />;
}
