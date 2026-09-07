import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret, MissingSecretKeyError, secretHint, secretsMatch } from "./secrets";

const ORIGINAL = process.env.CONFIG_ENCRYPTION_KEY;
process.env.CONFIG_ENCRYPTION_KEY = "test-secret-for-unit-tests";

test("a secret survives a round trip", () => {
  const value = "sk-abcdef0123456789";
  assert.equal(decryptSecret(encryptSecret(value)), value);
});

test("the same plaintext encrypts differently every time", () => {
  // A fresh IV per write, or two providers sharing a key would be visibly identical rows.
  assert.notEqual(encryptSecret("sk-same"), encryptSecret("sk-same"));
});

test("a tampered ciphertext is unreadable rather than silently wrong", () => {
  const stored = encryptSecret("sk-abcdef0123456789");
  const parts = stored.split(":");
  const flipped = Buffer.from(parts[3], "base64");
  flipped[0] ^= 0xff;
  parts[3] = flipped.toString("base64");
  assert.equal(decryptSecret(parts.join(":")), null);
});

test("a rotated process secret reports unreadable instead of throwing", () => {
  const stored = encryptSecret("sk-abcdef0123456789");
  process.env.CONFIG_ENCRYPTION_KEY = "a-different-secret";
  assert.equal(decryptSecret(stored), null);
  process.env.CONFIG_ENCRYPTION_KEY = "test-secret-for-unit-tests";
});

test("malformed and empty stored values are handled", () => {
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(""), null);
  assert.equal(decryptSecret("not-a-cipher"), null);
  assert.equal(decryptSecret("v2:a:b:c"), null);
});

test("the hint shows four characters and nothing of a short key", () => {
  assert.equal(secretHint("sk-abcdef0123456789"), "…6789");
  assert.equal(secretHint("short"), "…");
});

test("matching is exact", () => {
  assert.equal(secretsMatch("abc", "abc"), true);
  assert.equal(secretsMatch("abc", "abd"), false);
  assert.equal(secretsMatch("abc", "abcd"), false);
});

test("a process with no secret configured refuses to store one", () => {
  delete process.env.CONFIG_ENCRYPTION_KEY;
  const auth = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  assert.throws(() => encryptSecret("sk-x"), MissingSecretKeyError);
  process.env.CONFIG_ENCRYPTION_KEY = "test-secret-for-unit-tests";
  if (auth !== undefined) process.env.AUTH_SECRET = auth;
});

test.after(() => {
  if (ORIGINAL === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
  else process.env.CONFIG_ENCRYPTION_KEY = ORIGINAL;
});
