import 'dotenv/config';
import { kjørBlokkerende } from '../services/openaiService';

async function main() {
  console.log('[Test] Tester kjørBlokkerende mot Azure OpenAI\n');

  // Test 1: Enkel sanity-sjekk
  console.log('[Test 1] Enkel matte-prompt');
  const test1 = await kjørBlokkerende(
    'Du er en kortfattet assistent. Svar med kun tallet.',
    'Hva er 2 + 2?',
  );
  console.log(`  Svar: "${test1.tekst.trim()}"`);
  console.log(`  Tokens: ${test1.promptTokens}+${test1.completionTokens}=${test1.totaltTokens}`);
  console.log(`  Modell: ${test1.modell}`);
  console.log('  Forventet svar: "4"\n');

  // Test 2: Norsk + tallformat-test (varekostnad-systemprompt)
  console.log('[Test 2] Norsk varekostnad-analyse med dummy-data');
  const systemPrompt = `Du er en senior økonomianalytiker for LNS, et norsk bygg- og anleggskonsern. Du lager varekostnadsanalyser basert på faktiske regnskapstall.

Regler:
- Svar alltid på norsk
- Vær konkret med tall — bruk norsk tallformat (mellomrom som tusenskille, komma som desimalskille, f.eks. "4 235 189,50 kr")
- Ikke spekuler utover data du faktisk har
- Bruk saklig tone, ikke markedsføringsspråk`;

  const brukerPrompt = `Skriv et kort sammendrag (2-3 setninger) basert på følgende data:

## totalt_per_maaned
| maaned | belop |
| 202601 | -6278181.55 |
| 202602 | -5048528.82 |
| 202603 | -4323567.53 |

Instruks: Beskriv utviklingen i varekostnad gjennom Q1 2026 for prosjektet. Bruk norsk tallformat.`;

  const test2 = await kjørBlokkerende(systemPrompt, brukerPrompt, {
    temperatur: 0.3,
    maksTokens: 500,
  });
  console.log(`  Svar:\n${test2.tekst}`);
  console.log(`\n  Tokens: ${test2.promptTokens}+${test2.completionTokens}=${test2.totaltTokens}`);
  console.log(`  (Sjekk at norsk + tallformat fungerer)\n`);

  // Test 3: Latens-test
  console.log('[Test 3] Latens på et lite kall');
  const start = Date.now();
  const test3 = await kjørBlokkerende(
    'Du er presis.',
    'List opp 3 farger.',
    { maksTokens: 100 },
  );
  const tid = Date.now() - start;
  console.log(`  Svar: "${test3.tekst.trim()}"`);
  console.log(`  Latens (totalt fra script-side): ${tid}ms`);
  console.log(`  Tokens: ${test3.totaltTokens}`);

  console.log('\n[Test] Alle tester ferdig. ✓');
  process.exit(0);
}

main().catch(err => {
  console.error('[Test] Feil:', err);
  process.exit(1);
});
