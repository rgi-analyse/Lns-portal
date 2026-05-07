/**
 * Test-script: end-to-end-validering av slicerKatalogService.
 *
 * Trinn:
 *   1. Sikre at indeksen "synapse-slicer-katalog" finnes
 *   2. Indeksér 5 manuelle test-verdier
 *   3. Vent kort på at indeksen blir søkbar (Azure Search er eventually consistent)
 *   4. Kjør 4 søk og print scores
 *
 * Indeksen beholdes — den vil bli erstattet av reell data senere via PBI executeQueries.
 */

import 'dotenv/config';
import {
  sikreIndeksFinnes,
  indekserVerdier,
  søk,
  type SlicerVerdi,
} from '../src/services/slicerKatalogService';

const RAPPORT_RESULTAT = '6c758833-1f94-497f-b89a-2e89b4db2af7';
const RAPPORT_LEV      = '8a686e18-aaaa-bbbb-cccc-ddddeeeeffff';

const TEST_VERDIER: SlicerVerdi[] = [
  {
    tenant: 'lns', rapport_id: RAPPORT_RESULTAT,
    slicer_tittel: 'Hovedprosjekt', slicer_type: 'hierarchy',
    verdi:          '4200 - Nussir',
    forelder_verdi: '250 - Gruvedrift',
  },
  {
    tenant: 'lns', rapport_id: RAPPORT_RESULTAT,
    slicer_tittel: 'Hovedprosjekt', slicer_type: 'hierarchy',
    verdi:          '4600 - Snøhvit Future Project',
    forelder_verdi: '200 - Tunnel',
  },
  {
    tenant: 'lns', rapport_id: RAPPORT_RESULTAT,
    slicer_tittel: 'Hovedprosjekt', slicer_type: 'hierarchy',
    verdi:          '5400 - Rana Gruber',
    forelder_verdi: '250 - Gruvedrift',
  },
  {
    tenant: 'lns', rapport_id: RAPPORT_LEV,
    slicer_tittel: 'LevNavn', slicer_type: 'basic',
    verdi:          'BDO AS',
    synonymer:      ['BDO'],
  },
  {
    tenant: 'lns', rapport_id: RAPPORT_LEV,
    slicer_tittel: 'LevNavn', slicer_type: 'basic',
    verdi:          'Vianor AS',
  },
];

interface SøkScenario {
  navn:           string;
  rapport_id:     string;
  slicer_tittel:  string;
  søketerm:       string;
  forventetTreff: string;
}

const SCENARIOER: SøkScenario[] = [
  { navn: 'Hovedprosjekt + "Nussir"', rapport_id: RAPPORT_RESULTAT, slicer_tittel: 'Hovedprosjekt', søketerm: 'Nussir', forventetTreff: '4200 - Nussir' },
  { navn: 'Hovedprosjekt + "4600"',   rapport_id: RAPPORT_RESULTAT, slicer_tittel: 'Hovedprosjekt', søketerm: '4600',   forventetTreff: '4600 - Snøhvit Future Project' },
  { navn: 'Hovedprosjekt + "Rana"',   rapport_id: RAPPORT_RESULTAT, slicer_tittel: 'Hovedprosjekt', søketerm: 'Rana',   forventetTreff: '5400 - Rana Gruber' },
  { navn: 'LevNavn + "BDO" (synonym)', rapport_id: RAPPORT_LEV,     slicer_tittel: 'LevNavn',       søketerm: 'BDO',    forventetTreff: 'BDO AS' },
];

function vent(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('TEST — slicer-katalog setup');
  console.log('═══════════════════════════════════════════════════\n');

  console.log('1) Sikrer indeks');
  await sikreIndeksFinnes();

  console.log('\n2) Indekserer 5 test-verdier');
  await indekserVerdier(TEST_VERDIER);

  // Azure Search trenger litt tid før indekserte dokumenter er søkbare.
  console.log('\n3) Venter 3 sek på indeksering...');
  await vent(3000);

  console.log('\n4) Kjører søk:');
  let alleOk = true;
  for (const s of SCENARIOER) {
    const respons = await søk({
      tenant:         'lns',
      rapport_id:     s.rapport_id,
      slicer_tittel:  s.slicer_tittel,
      søketerm:       s.søketerm,
      top:            5,
    });

    const førsteTreff = respons.treff[0];
    const ok = førsteTreff?.verdi === s.forventetTreff;
    if (!ok) alleOk = false;

    console.log(`\n  [${ok ? '✓' : '✗'}] ${s.navn}`);
    console.log(`      Forventet: "${s.forventetTreff}"`);
    if (respons.treff.length === 0) {
      console.log(`      Ingen treff`);
    } else {
      respons.treff.forEach((t, i) => {
        const merket = t.verdi === s.forventetTreff ? '←' : ' ';
        console.log(`      ${i + 1}. score=${t.score.toFixed(3)}  "${t.verdi}"${t.forelder_verdi ? ` (under ${t.forelder_verdi})` : ''} ${merket}`);
      });
    }
  }

  console.log('\n───────────────────────────────────────────────────');
  console.log(alleOk
    ? '✓ Alle 4 søk traff forventet verdi som #1'
    : '✗ Minst ett søk traff feil — sjekk scores over');
  console.log('───────────────────────────────────────────────────\n');

  if (!alleOk) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
