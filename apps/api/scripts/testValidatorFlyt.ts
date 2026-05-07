/**
 * Simulerer hva validator-laget ville gjort for hvert test-scenario.
 *
 * Vi kan ikke kjøre hele AI-samtaleflyten her, men vi kan teste
 * byggekloss-laget (erIndeksert + søk + erTvetydig) som validatoren
 * baserer seg på, og demonstrere hva slags utfall AI ville sett.
 */

import 'dotenv/config';
import {
  erIndeksert,
  søk,
  velgFraTreff,
} from '../src/services/slicerKatalogService';

const RAPPORT_RESULTAT = '6c758833-1f94-497f-b89a-2e89b4db2af7';
const RAPPORT_LEV      = '8a686e18-5ed2-449c-a010-7cc6a6cd25d7';
const RAPPORT_USETT    = '11111111-2222-3333-4444-555555555555';

interface Scenario {
  navn:           string;
  tenant:         string;
  rapport_id:     string;
  slicer_tittel:  string;
  søketerm:       string;
  forelder?:      string;
}

const SCENARIOER: Scenario[] = [
  { navn: '1. Leverandør "BDO AS" (eksakt streng) — forventet ENTYDIG (eksakt vinner)',
    tenant: 'lns', rapport_id: RAPPORT_LEV, slicer_tittel: 'LevNavn', søketerm: 'BDO AS' },

  { navn: '2. Leverandør "BDO" (kortform) — forventet TVETYDIG (BDO AS + BDO Advokater AS)',
    tenant: 'lns', rapport_id: RAPPORT_LEV, slicer_tittel: 'LevNavn', søketerm: 'BDO' },

  { navn: '3. Leverandør "Vianor" — forventet ENTYDIG (Vianor AS)',
    tenant: 'lns', rapport_id: RAPPORT_LEV, slicer_tittel: 'LevNavn', søketerm: 'Vianor' },

  { navn: '4. Leverandør "Apple" (finnes ikke) — forventet NONE',
    tenant: 'lns', rapport_id: RAPPORT_LEV, slicer_tittel: 'LevNavn', søketerm: 'Apple' },

  { navn: '5a. Hovedprosjekt-barn "Nussir" under "250 - Gruvedrift" — forventet ENTYDIG',
    tenant: 'lns', rapport_id: RAPPORT_RESULTAT, slicer_tittel: 'Hovedprosjekt',
    søketerm: 'Nussir', forelder: '250 - Gruvedrift' },

  { navn: '5b. Hovedprosjekt-barn "Snøhvit" under "200 - Tunnel" — forventet ENTYDIG',
    tenant: 'lns', rapport_id: RAPPORT_RESULTAT, slicer_tittel: 'Hovedprosjekt',
    søketerm: 'Snøhvit', forelder: '200 - Tunnel' },

  { navn: '6. Maskinliste-slicer som IKKE er indeksert — forventet FALLBACK til lokal',
    tenant: 'lns', rapport_id: RAPPORT_USETT, slicer_tittel: 'Anlegg', søketerm: 'Elkem' },
];

async function simulerScenario(s: Scenario): Promise<void> {
  console.log(`\n${s.navn}`);

  // Steg 1: Sjekk om sliceren er indeksert (validator gjør dette først)
  const status = await erIndeksert(s.tenant, s.rapport_id, s.slicer_tittel);
  if (!status.indeksert) {
    console.log('   → FALLBACK: sliceren er ikke indeksert. Validator faller tilbake til lokal-only matching');
    console.log('     (samme oppførsel som før AI Search ble lagt til)');
    return;
  }
  console.log(`   → indeksert: ${status.antallDokumenter} dokumenter, sist ${status.sistIndeksert?.toISOString()}`);

  // Steg 2: Søk
  const respons = await søk({
    tenant:         s.tenant,
    rapport_id:     s.rapport_id,
    slicer_tittel:  s.slicer_tittel,
    søketerm:       s.søketerm,
    forelder_verdi: s.forelder,
    top:            5,
  });

  if (respons.treff.length === 0) {
    console.log('   → NONE: ingen AI Search-treff. Validator returnerer not_found til AI.');
    return;
  }

  // Steg 3: Vurdering med eksakt-match-prioritet og terskel-filtrering
  const vurdering = velgFraTreff(respons.treff, s.søketerm);
  console.log(`   → råtreff: ${respons.treff.length}`);
  respons.treff.forEach((t, i) => {
    console.log(`      ${i + 1}. score=${t.score.toFixed(3)}  "${t.verdi}"${t.forelder_verdi ? ` (under ${t.forelder_verdi})` : ''}`);
  });

  if (vurdering.type === 'none') {
    console.log('   → NONE: alle treff under terskel. Validator returnerer not_found.');
  } else if (vurdering.type === 'unique') {
    console.log(`   → ENTYDIG: validator korrigerer "${s.søketerm}" → "${vurdering.treff}"`);
  } else {
    console.log(`   → TVETYDIG: ${vurdering.alle.length} relevante etter filtrering. Validator spør AI:`);
    vurdering.alle.forEach((t, i) => {
      console.log(`      ${i + 1}. "${t.verdi}" (score ${t.score.toFixed(2)})`);
    });
  }
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('TEST — validator-flyt simulering');
  console.log('═══════════════════════════════════════════════════');

  for (const s of SCENARIOER) {
    await simulerScenario(s);
  }

  console.log('\n───────────────────────────────────────────────────');
  console.log('Hver scenario viser hva AI ville mottatt fra validatoren.');
  console.log('Faktisk AI-respons må verifiseres via chat-grensesnittet.');
  console.log('───────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
