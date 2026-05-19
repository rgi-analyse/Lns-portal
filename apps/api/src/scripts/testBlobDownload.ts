import 'dotenv/config';
import { lastNedBlob } from '../services/blobService';

/**
 * Verifiserer nedlasting av en eksisterende blob.
 * Bruk:
 *   npx tsx src/scripts/testBlobDownload.ts <blob-sti>
 * Eksempel (graf-PNG fra en fullført bestilling):
 *   npx tsx src/scripts/testBlobDownload.ts 85e05acf-ee05-4e29-ad55-26b3359a870c/grafer/utvikling.png
 */
async function main() {
  const blobSti = process.argv[2];
  if (!blobSti) {
    console.error('Bruk: npx tsx src/scripts/testBlobDownload.ts <blob-sti>');
    console.error('Eks:  npx tsx src/scripts/testBlobDownload.ts <bestillingId>/grafer/<seksjon>.png');
    process.exit(1);
  }

  console.log('[Test] BLOB_ACCOUNT_URL:', process.env.BLOB_ACCOUNT_URL ?? 'IKKE SATT');
  console.log('[Test] BLOB_CONTAINER_NAME:', process.env.BLOB_CONTAINER_NAME ?? 'IKKE SATT');
  console.log('[Test] Laster ned:', blobSti, '\n');

  const buffer = await lastNedBlob(blobSti);

  // Sanity: er det en PNG? (magic: 89 50 4E 47)
  const erPng =
    buffer.length > 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 &&
    buffer[2] === 0x4e && buffer[3] === 0x47;

  console.log('\n[Test] Resultat:');
  console.log('  Bytes:', buffer.length);
  console.log('  PNG-header:', erPng ? 'JA (gyldig PNG)' : 'NEI (ikke PNG / annet format)');
  console.log('  Første 8 bytes (hex):', buffer.subarray(0, 8).toString('hex'));

  console.log('\n[Test] Nedlasting OK ✓');
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
