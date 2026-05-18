import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const ACCOUNT_URL = process.env.BLOB_ACCOUNT_URL ?? '';
const CONTAINER_NAME = process.env.BLOB_CONTAINER_NAME ?? '';

let containerClient: ContainerClient | null = null;

function getContainerClient(): ContainerClient {
  if (!ACCOUNT_URL) {
    throw new Error('BLOB_ACCOUNT_URL ikke satt i env');
  }
  if (!CONTAINER_NAME) {
    throw new Error('BLOB_CONTAINER_NAME ikke satt i env');
  }

  if (!containerClient) {
    const credential = new DefaultAzureCredential();
    const serviceClient = new BlobServiceClient(ACCOUNT_URL, credential);
    containerClient = serviceClient.getContainerClient(CONTAINER_NAME);
    console.log(`[Blob] Container client initialisert: ${CONTAINER_NAME} på ${ACCOUNT_URL}`);
  }

  return containerClient;
}

export interface UploadResultat {
  blobSti: string;        // f.eks. "85e05acf-.../grafer/utvikling.png"
  fullUrl: string;        // full URL (uten SAS)
  storrelseBytes: number;
}

export async function lastOppBlob(
  buffer: Buffer,
  blobSti: string,
  contentType = 'application/octet-stream',
): Promise<UploadResultat> {
  const container = getContainerClient();
  const blockBlob = container.getBlockBlobClient(blobSti);

  console.log(`[Blob] Laster opp: ${blobSti} (${buffer.length} bytes, type: ${contentType})`);
  const start = Date.now();

  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  const latens = Date.now() - start;
  console.log(`[Blob] Opplastet OK: ${blobSti} (${latens}ms)`);

  return {
    blobSti,
    fullUrl: blockBlob.url,
    storrelseBytes: buffer.length,
  };
}

/**
 * Sletter en blob hvis den finnes. Brukes typisk ikke i prod-flyt,
 * men nyttig for testing/opprydding.
 */
export async function slettBlob(blobSti: string): Promise<boolean> {
  const container = getContainerClient();
  const blockBlob = container.getBlockBlobClient(blobSti);

  const respons = await blockBlob.deleteIfExists();
  if (respons.succeeded) {
    console.log(`[Blob] Slettet: ${blobSti}`);
  }
  return respons.succeeded;
}
