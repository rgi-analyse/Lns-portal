import 'dotenv/config';
import { lastOppBlob, slettBlob } from '../services/blobService';

async function main() {
  console.log('[Test] Tester blobService med Managed Identity\n');

  // Verifiser env
  console.log('[Test] BLOB_ACCOUNT_URL:', process.env.BLOB_ACCOUNT_URL ?? 'IKKE SATT');
  console.log('[Test] BLOB_CONTAINER_NAME:', process.env.BLOB_CONTAINER_NAME ?? 'IKKE SATT');
  console.log('');

  if (!process.env.BLOB_ACCOUNT_URL || !process.env.BLOB_CONTAINER_NAME) {
    console.error('[Test] Mangler env-vars. Sett dem i .env eller miljø.');
    process.exit(1);
  }

  // Test 1: Last opp en liten test-fil
  console.log('[Test 1] Last opp tekst-fil');
  const testInnhold = Buffer.from('Hei fra blob-test! ' + new Date().toISOString(), 'utf-8');
  const testSti = `_test/blob-test-${Date.now()}.txt`;

  const resultat1 = await lastOppBlob(testInnhold, testSti, 'text/plain');
  console.log('  blobSti:', resultat1.blobSti);
  console.log('  fullUrl:', resultat1.fullUrl);
  console.log('  storrelse:', resultat1.storrelseBytes, 'bytes');
  console.log('');

  // Test 2: Last opp en større PNG-fil (simulert)
  console.log('[Test 2] Last opp simulert PNG');
  // 100KB random data som simulerer en PNG
  const pngTest = Buffer.alloc(100_000);
  pngTest.write('\x89PNG\r\n\x1a\n', 0, 'binary');  // PNG header
  const pngSti = `_test/test-${Date.now()}.png`;

  const resultat2 = await lastOppBlob(pngTest, pngSti, 'image/png');
  console.log('  blobSti:', resultat2.blobSti);
  console.log('  storrelse:', resultat2.storrelseBytes, 'bytes');
  console.log('');

  // Test 3: Rydd opp — slett testfiler
  console.log('[Test 3] Rydd opp test-blobs');
  const slettet1 = await slettBlob(resultat1.blobSti);
  const slettet2 = await slettBlob(resultat2.blobSti);
  console.log('  Slettet test 1:', slettet1);
  console.log('  Slettet test 2:', slettet2);

  console.log('\n[Test] Alle tester ferdig. ✓');
  process.exit(0);
}

main().catch(err => {
  console.error('[Test] Feil:', err);
  if (err.statusCode) {
    console.error('  Status:', err.statusCode);
    console.error('  Code:', err.code);
  }
  process.exit(1);
});
