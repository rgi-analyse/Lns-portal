import { writeFileSync } from 'fs';
import { join } from 'path';
import { lagGrafPng, type GrafFarger } from '../services/grafService';

// LNS-farger (samme som dbo.OrganisasjonSchema-raden: #ffbb00 / #0a1628)
const farger: GrafFarger = {
  primær: '#ffbb00',
  bakgrunn: '#0a1628',
  navy: '#1B2A4A',
  aksent: '#243556',
  tekst: '#FFFFFF',
  tekstMuted: 'rgba(255,255,255,0.55)',
};

async function main() {
  console.log('[Test] Genererer grafer med LNS-tema\n');
  const utMappe = process.cwd();

  // 1. bar_vertikal — utvikling over tid (negative verdier)
  const barVData = [
    { maaned: 202601, belop: -6278181.55 },
    { maaned: 202602, belop: -5048528.82 },
    { maaned: 202603, belop: -4323567.53 },
  ];
  const barVPng = await lagGrafPng(
    { type: 'bar_vertikal', xKolonne: 'maaned', yKolonne: 'belop', tittel: 'Varekostnad per måned — Q1 2026', xFormat: 'aarmaaned' },
    barVData,
    farger,
  );
  const barVSti = join(utMappe, 'bar_vertikal.png');
  writeFileSync(barVSti, barVPng);
  console.log(`[Test] bar_vertikal.png lagret (${Math.round(barVPng.length / 1024)} KB)`);

  // 2. bar_horisontal — topp leverandører (blandet fortegn, langt navn, æøå)
  const barHData = [
    { Leverandør: '(ikke navngitt)', belop: 5864510.44 },
    { Leverandør: 'Heidelberg Materials Sement Norge AS', belop: 1240800 },
    { Leverandør: 'Leonhard Nilsen & Sønner - Eiendom AS', belop: 980500 },
    { Leverandør: 'ISS Facility Services AS', belop: 10800 },
    { Leverandør: 'Tools AS', belop: -3296.89 },
    { Leverandør: 'Sihcon AS', belop: -5997.81 },
    { Leverandør: 'Ahlsell Norge AS', belop: -12450.5 },
    { Leverandør: 'Würth Norge AS', belop: -18900 },
    { Leverandør: 'Motek AS', belop: -24310.75 },
    { Leverandør: 'Brødrene Dahl AS', belop: -41200 },
  ];
  const barHPng = await lagGrafPng(
    { type: 'bar_horisontal', xKolonne: 'belop', yKolonne: 'Leverandør', tittel: 'Topp 10 leverandører' },
    barHData,
    farger,
  );
  const barHSti = join(utMappe, 'bar_horisontal.png');
  writeFileSync(barHSti, barHPng);
  console.log(`[Test] bar_horisontal.png lagret (${Math.round(barHPng.length / 1024)} KB)`);

  // 3. pie — fordeling kontogruppe
  const pieData = [
    { Kontogruppe: 'Direkte prosjektkostnader', belop: 10000000 },
    { Kontogruppe: 'Periodiseringer', belop: 5000000 },
  ];
  const piePng = await lagGrafPng(
    { type: 'pie', labelKolonne: 'Kontogruppe', verdiKolonne: 'belop', tittel: 'Fordeling per kontogruppe' },
    pieData,
    farger,
  );
  const pieSti = join(utMappe, 'pie.png');
  writeFileSync(pieSti, piePng);
  console.log(`[Test] pie.png lagret (${Math.round(piePng.length / 1024)} KB)`);

  console.log('\n[Test] Alle 3 grafer generert. Åpne PNG-ene for visuell vurdering.');
  process.exit(0);
}

main().catch(err => {
  console.error('[Test] Feil:', err);
  process.exit(1);
});
