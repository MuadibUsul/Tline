import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// promisify resolves to the overload without options, which is the one form this needs.
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password storage.
 *
 * scrypt comes with Node, so this needs no dependency, and unlike a plain digest it is
 * deliberately slow and memory-hard: a stolen table cannot be run through a wordlist at
 * speed. Parameters are written into each record, so they can be raised later without
 * invalidating the passwords already stored.
 */

const KEY_LENGTH = 64;
// 128 * N * r bytes of working memory — 16 MB here, which costs roughly a tenth of a
// second per attempt and is the point.
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISATION = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(plain.normalize("NFKC"), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISATION,
    maxmem: MAX_MEMORY,
  });
  return ["scrypt", COST, BLOCK_SIZE, PARALLELISATION, salt.toString("base64"), derived.toString("base64")].join("$");
}

export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, cost, blockSize, parallelisation, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;

  const expectedBuffer = Buffer.from(expected, "base64");
  let derived: Buffer;
  try {
    derived = await scrypt(plain.normalize("NFKC"), Buffer.from(salt, "base64"), expectedBuffer.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelisation),
      maxmem: MAX_MEMORY,
    });
  } catch {
    // A record with parameters this build cannot honour is a failed match, not a crash.
    return false;
  }
  return derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer);
}

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Why a password is unacceptable, or null when it is fine.
 *
 * Length is the rule that actually buys resistance, so the others stay few: a password
 * the account's own address gives away, and the handful of strings every list starts
 * with. Composition rules are left out on purpose — they push people towards
 * "Password1!" and buy nothing.
 */
export function passwordProblem(plain: string, email?: string | null): "short" | "long" | "email" | "common" | null {
  const value = plain.normalize("NFKC");
  if (value.length < PASSWORD_MIN_LENGTH) return "short";
  // scrypt hashes whatever it is given; the cap only stops a huge request being work.
  if (value.length > 200) return "long";

  const lower = value.toLowerCase();
  const local = (email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (email && (lower === email.toLowerCase() || (local.length >= 3 && lower === local))) return "email";

  const obvious = ["password", "12345678", "qwertyuiop", "letmein", "iloveyou", "administrator"];
  if (obvious.some((candidate) => lower === candidate || lower.startsWith(candidate))) return "common";
  return null;
}
