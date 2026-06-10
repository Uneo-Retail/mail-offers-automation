/**
 * Stockage des fichiers (PDF, plans, photos) sur Azure Blob.
 *
 * Choix par défaut (recommandé pour des données de baux) : container PRIVÉ +
 * URL SAS longue durée en lecture seule (cf. À VALIDER §10.2). L'URL SAS est
 * stockée dans les propriétés `file`/`url` Notion.
 */
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  type ContainerClient,
} from "@azure/storage-blob";
import { azureConfig } from "../config.js";
import { log } from "../log.js";

let service: BlobServiceClient | null = null;
let credential: StorageSharedKeyCredential | null = null;
let containerReady: Promise<ContainerClient> | null = null;

function parseConnString(conn: string): { account: string; key: string } | null {
  const account = /AccountName=([^;]+)/i.exec(conn)?.[1];
  const key = /AccountKey=([^;]+)/i.exec(conn)?.[1];
  return account && key ? { account, key } : null;
}

function getService(): BlobServiceClient {
  if (!service) {
    const cfg = azureConfig();
    service = BlobServiceClient.fromConnectionString(cfg.connectionString);
    const parsed = parseConnString(cfg.connectionString);
    if (parsed) credential = new StorageSharedKeyCredential(parsed.account, parsed.key);
  }
  return service;
}

function getContainer(): Promise<ContainerClient> {
  if (!containerReady) {
    const cfg = azureConfig();
    const container = getService().getContainerClient(cfg.container);
    // container privé (pas d'accès public)
    containerReady = container.createIfNotExists().then(() => container);
  }
  return containerReady;
}

/** Chemin de blob lisible et sûr : {messageId}/{filename normalisé}. */
function blobPath(messageId: string, filename: string): string {
  const safeId = messageId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  const safeName = filename.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\s+/g, "_");
  return `${safeId}/${safeName}`;
}

export interface UploadedFile {
  name: string;
  url: string;
}

/**
 * Upload un buffer et renvoie une URL SAS lecture seule (TTL = AZURE_SAS_TTL_DAYS).
 * Si la génération SAS échoue (credential indisponible), renvoie l'URL nue (utile
 * seulement si le container est public — sinon le lien ne sera pas lisible).
 */
export async function uploadFile(
  messageId: string,
  filename: string,
  data: Buffer,
  contentType?: string
): Promise<UploadedFile> {
  const cfg = azureConfig();
  const container = await getContainer();
  const path = blobPath(messageId, filename);
  const blob = container.getBlockBlobClient(path);
  await blob.uploadData(data, {
    blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
  });

  let url = blob.url;
  if (credential) {
    const expiresOn = new Date(Date.now() + cfg.sasTtlDays * 24 * 60 * 60 * 1000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: cfg.container,
        blobName: path,
        permissions: BlobSASPermissions.parse("r"),
        startsOn: new Date(Date.now() - 5 * 60 * 1000),
        expiresOn,
      },
      credential
    ).toString();
    url = `${blob.url}?${sas}`;
  } else {
    log.warn("azureBlob: pas de credential SharedKey → URL sans SAS (container public requis)");
  }
  return { name: filename, url };
}
