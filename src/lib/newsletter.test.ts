import assert from "node:assert/strict";
import test from "node:test";
import { confirmUrl, isPlausibleEmail, newConfirmToken, nextStatusAfterResubscribe, normalizeEmail, unsubscribeUrl } from "./newsletter";
import { siteUrl } from "./site";

test("an address is trimmed and case-folded, so one identity is one row", () => {
  assert.equal(normalizeEmail("  Reader@Example.COM "), "reader@example.com");
  assert.equal(normalizeEmail("reader@example.com"), "reader@example.com");
});

test("addresses a mail server would accept are accepted", () => {
  for (const email of [
    "reader@example.com",
    "a@b.co", // the shortest form worth calling an address
    "first.last+tag@sub.example.co.uk",
    "x_y%z@example.io",
    "123@example.com",
    "  Padded@Example.com ", // whitespace and case are not defects
  ]) {
    assert.equal(isPlausibleEmail(email), true, email);
  }
});

test("what is plainly not an address is refused", () => {
  for (const email of [
    "",
    "   ",
    "reader",
    "reader@",
    "@example.com",
    "a@b", // no dot in the domain
    "a@b.", // empty last label
    "a@.com",
    "a b@example.com",
    "a@@example.com",
    "a@b..com",
    "a@-example.com",
    "a@example-.com",
    "a@example.c", // one-letter TLD
    ".a@example.com",
    "a.@example.com",
    "a..b@example.com",
    `${"x".repeat(65)}@example.com`, // local part past 64
    `a@${"x".repeat(250)}.com`, // domain past 253
  ]) {
    assert.equal(isPlausibleEmail(email), false, email);
  }
});

test("both links point at the one machine endpoint, token carried in the query", () => {
  const token = "test-token-abc";
  assert.equal(confirmUrl(token, "en"), `${siteUrl()}/api/newsletter/confirm?token=${token}`);

  const confirm = new URL(confirmUrl(token, "zh-CN"));
  assert.equal(confirm.origin, new URL(siteUrl()).origin);
  assert.equal(confirm.pathname, "/api/newsletter/confirm");
  assert.equal(confirm.searchParams.get("token"), token);
  // Default action: a confirmation needs no extra parameter.
  assert.equal(confirm.searchParams.get("action"), null);
  // A machine endpoint takes no language prefix: the language changes nothing in the URL.
  assert.equal(confirmUrl(token, "zh-CN"), confirmUrl(token, "en"));

  const leave = new URL(unsubscribeUrl(token, "en"));
  assert.equal(leave.origin, confirm.origin);
  assert.equal(leave.pathname, "/api/newsletter/confirm");
  assert.equal(leave.searchParams.get("token"), token);
  assert.equal(leave.searchParams.get("action"), "unsubscribe");
});

test("a resubmission re-enters double opt-in, an already-confirmed address stays put", () => {
  assert.equal(nextStatusAfterResubscribe("CONFIRMED"), "CONFIRMED");
  assert.equal(nextStatusAfterResubscribe("PENDING"), "PENDING");
  // Unsubscribing is a conclusion, not a ban: subscribing again starts a fresh consent.
  assert.equal(nextStatusAfterResubscribe("UNSUBSCRIBED"), "PENDING");
  // A row in an unexpected state, or none at all, is treated as a new signup.
  assert.equal(nextStatusAfterResubscribe(null), "PENDING");
  assert.equal(nextStatusAfterResubscribe(undefined), "PENDING");
  assert.equal(nextStatusAfterResubscribe("something-else"), "PENDING");
});

test("a confirmation token is URL-safe and distinct per minting", () => {
  const tokens = new Set(Array.from({ length: 50 }, () => newConfirmToken()));
  assert.equal(tokens.size, 50);
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(new URL(confirmUrl(token, "en")).searchParams.get("token"), token);
  }
});
