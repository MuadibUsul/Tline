import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Symmetric encryption for operator-supplied secrets held in the database.
 *
 * Provider API keys have to be readable by the process that calls the provider, so this is
 * reversible encryption, not hashing. What it buys is that a database dump, a backup file
 * or a stray query result does not hand over a working key — the reader also needs the
 * process secret, which lives in the environment and is never written to a row.
 */
const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
// Fixed salt: the input is a high-entropy server secret rather than a user password, so the
// salt is not defending against a dictionary attack. Deriving deterministically is what
// lets a restarted process read rows written by the previous one.
const SALT = "tline.secrets.v1";

export class MissingSecretKeyError extends Error {
  constructor() {
    super("Set CONFIG_ENCRYPTION_KEY (or AUTH_SECRET) before storing provider credentials.");
    this.name = "MissingSecretKeyError";
  }
}

function key(): Buffer {
  // AUTH_SECRET is accepted so an existing deployment can store a key without adding a new
  // variable first. Rotating it makes stored ciphertexts unreadable — decryptSecret reports
  // that as "unreadable" rather than crashing, and the console asks for the key again.
  const secret = process.env.CONFIG_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) throw new MissingSecretKeyError();
  return scryptSync(secret, SALT, 32);
}

export function hasSecretKey(): boolean {
  return Boolean(process.env.CONFIG_ENCRYPTION_KEY || process.env.AUTH_SECRET);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Returns null for anything this process cannot read, including a rotated secret. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [version, iv, tag, ciphertext] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, or a tampered row: the GCM tag check fails and there is nothing to return.
    return null;
  }
}

/**
 * The only part of a key the console is allowed to display.
 *
 * Four characters identify a key to the person who pasted it without being enough to use.
 * Short strings reveal nothing at all rather than most of themselves.
 */
export function secretHint(plaintext: string): string {
  const trimmed = plaintext.trim();
  return trimmed.length <= 8 ? "…" : `…${trimmed.slice(-4)}`;
}

/** Constant-time comparison, for confirming a re-entered secret without leaking timing. */
export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
