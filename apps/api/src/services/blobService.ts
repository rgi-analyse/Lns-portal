import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { logger } from '../lib/logger';

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
    logger.debug(`[Blob] Container client initialisert: ${CONTAINER_NAME} på ${ACCOUNT_URL}`);
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

  logger.debug(`[Blob] Laster opp: ${blobSti} (${buffer.length} bytes, type: ${contentType})`);
  const start = Date.now();

  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  const latens = Date.now() - start;
  logger.debug(`[Blob] Opplastet OK: ${blobSti} (${latens}ms)`);

  return {
    blobSti,
    fullUrl: blockBlob.url,
    storrelseBytes: buffer.length,
  };
}

/**
 * Laster ned en blob til en Buffer. Brukes i Steg F for å hente
 * graf-PNG-er (lagret i Steg E) inn i Word-dokumentet.
 */
export async function lastNedBlob(blobSti: string): Promise<Buffer> {
  const container = getContainerClient();
  const blockBlob = container.getBlockBlobClient(blobSti);

  logger.debug(`[Blob] Laster ned: ${blobSti}`);
  const start = Date.now();

  const buffer = await blockBlob.downloadToBuffer();

  const latens = Date.now() - start;
  logger.debug(`[Blob] Nedlastet OK: ${blobSti} (${buffer.length} bytes, ${latens}ms)`);

  return buffer;
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
    logger.debug(`[Blob] Slettet: ${blobSti}`);
  }
  return respons.succeeded;
}
