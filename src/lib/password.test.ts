import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, passwordProblem, verifyPassword, PASSWORD_MIN_LENGTH } from "./password";

test("a stored password verifies and a wrong one does not", async () => {
  const stored = await hashPassword("correct horse battery");
  assert.equal(await verifyPassword("correct horse battery", stored), true);
  assert.equal(await verifyPassword("correct horse batteru", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("the same password stores differently every time", async () => {
  // Distinct salts: one cracked record must not reveal another using the same password.
  const [a, b] = await Promise.all([hashPassword("same password here"), hashPassword("same password here")]);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same password here", b), true);
});

test("the plaintext never appears in the stored record", async () => {
  const stored = await hashPassword("a memorable secret");
  assert.ok(!stored.includes("memorable"));
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$/);
});

test("an absent or damaged record fails rather than throwing", async () => {
  assert.equal(await verifyPassword("anything", null), false);
  assert.equal(await verifyPassword("anything", ""), false);
  assert.equal(await verifyPassword("anything", "not-a-record"), false);
  assert.equal(await verifyPassword("anything", "bcrypt$1$2$3$salt$hash"), false);
  // Parameters this build cannot honour must read as a mismatch, not a crash.
  assert.equal(await verifyPassword("anything", "scrypt$999999999$8$1$c2FsdA==$aGFzaA=="), false);
});

test("unicode passwords survive normalisation differences", async () => {
  // The same string composed two ways must open the same account.
  const stored = await hashPassword("café passphrase");
  assert.equal(await verifyPassword("café passphrase", stored), true);
});

test("weak passwords are named, sound ones pass", () => {
  assert.equal(passwordProblem("short"), "short");
  assert.equal(passwordProblem("a".repeat(201)), "long");
  assert.equal(passwordProblem("password123"), "common");
  assert.equal(passwordProblem("owner@example.com", "owner@example.com"), "email");
  assert.equal(passwordProblem("owner", "owner@example.com"), "short");
  assert.equal(passwordProblem("wolfsuchen", "wolfsuchen@gmail.com"), "email");
  assert.equal(passwordProblem("a sound enough passphrase"), null);
  assert.equal(passwordProblem("x".repeat(PASSWORD_MIN_LENGTH)), null);
});
