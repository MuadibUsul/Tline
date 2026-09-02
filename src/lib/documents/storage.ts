import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface DocumentStorage {
  put(key: string, data: Buffer): Promise<{ key: string; size: number }>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  signedDownloadUrl?(key: string, filename: string, mimeType: string): Promise<string>;
}

export const storageRoot = path.resolve(process.env.DOCUMENT_STORAGE_ROOT || path.join(process.cwd(), "storage"));

function resolveKey(key: string) {
  validateKey(key);
  const target = path.resolve(storageRoot, key);
  const relative = path.relative(storageRoot, target);
  if (!key || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid private storage key.");
  }
  return target;
}

function validateKey(key: string) {
  const normalized = path.posix.normalize(key.replaceAll("\\", "/"));
  if (!key || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw new Error("Invalid private storage key.");
  }
  return normalized;
}

class LocalDocumentStorage implements DocumentStorage {
  async put(key: string, data: Buffer) {
    const target = resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = target + "." + process.pid + ".tmp";
    await writeFile(temp, data);
    await rename(temp, target);
    return { key, size: data.byteLength };
  }

  get(key: string) {
    return readFile(resolveKey(key));
  }

  async exists(key: string) {
    try {
      return (await stat(resolveKey(key))).isFile();
    } catch {
      return false;
    }
  }

  async remove(key: string) {
    try {
      await unlink(resolveKey(key));
    } catch (error) {
      // Already gone is the outcome asked for.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

class S3DocumentStorage implements DocumentStorage {
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly client: S3Client;

  constructor() {
    this.bucket = process.env.S3_BUCKET || "";
    if (!this.bucket) throw new Error("S3_BUCKET is required for S3 document storage.");
    this.prefix = (process.env.S3_PREFIX || "tline").replace(/^\/+|\/+$/g, "");
    this.client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
  }

  private key(key: string) {
    const safe = validateKey(key);
    return this.prefix ? `${this.prefix}/${safe}` : safe;
  }

  async put(key: string, data: Buffer) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.key(key),
      Body: data,
      ContentType: "application/pdf",
      ServerSideEncryption: process.env.S3_SERVER_SIDE_ENCRYPTION === "AES256" ? "AES256" : undefined,
    }));
    return { key, size: data.byteLength };
  }

  async get(key: string) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
    if (!response.Body) throw new Error("Stored object has no body.");
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
  }

  signedDownloadUrl(key: string, filename: string, mimeType: string) {
    const configured = Number(process.env.S3_SIGNED_URL_TTL_SECONDS || 300);
    const expiresIn = Math.min(900, Math.max(30, Number.isFinite(configured) ? configured : 300));
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.key(key),
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      ResponseContentType: mimeType,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }
}

function createStorage(): DocumentStorage {
  const driver = process.env.DOCUMENT_STORAGE_DRIVER || "local";
  if (driver === "local") return new LocalDocumentStorage();
  if (driver === "s3") return new S3DocumentStorage();
  throw new Error(`Unsupported DOCUMENT_STORAGE_DRIVER=${driver}. Configure a registered private storage adapter.`);
}

let configuredStorage: DocumentStorage | undefined;

export function getDocumentStorage() {
  configuredStorage ??= createStorage();
  return configuredStorage;
}

export function writePrivateFile(key: string, data: Buffer) {
  return getDocumentStorage().put(key, data);
}

export function readPrivateFile(key: string) {
  return getDocumentStorage().get(key);
}

export function privateFileExists(key: string) {
  return getDocumentStorage().exists(key);
}

export function privateDownloadUrl(key: string, filename: string, mimeType: string) {
  return getDocumentStorage().signedDownloadUrl?.(key, filename, mimeType);
}
