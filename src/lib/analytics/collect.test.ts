import assert from "node:assert/strict";
import test from "node:test";
import { normalizePath, referrerHost } from "./collect";
import { dayKey, dayRange, shiftDay, visitorHash } from "./identity";

test("the query string never reaches the table", () => {
  // The one part of a URL that routinely carries a search term or an address.
  assert.deepEqual(normalizePath("/en/search?q=someone%40example.com"), { path: "/search", locale: "en" });
});

test("the language prefix is recorded apart from the page", () => {
  assert.deepEqual(normalizePath("/zh/research/abc"), { path: "/research/abc", locale: "zh-CN" });
  assert.deepEqual(normalizePath("/research/abc"), { path: "/research/abc", locale: "en" });
});

test("a trailing slash is not a different page, and the root survives", () => {
  assert.equal(normalizePath("/en/research/")?.path, "/research");
  assert.equal(normalizePath("/en")?.path, "/");
  assert.equal(normalizePath("/")?.path, "/");
});

test("an absolute URL yields only its path, so no host can be smuggled in", () => {
  assert.equal(normalizePath("https://evil.example/en/research")?.path, "/research");
});

test("junk is dropped rather than stored", () => {
  assert.equal(normalizePath(""), null);
  assert.equal(normalizePath(null), null);
  assert.equal(normalizePath(42), null);
});

test("a referrer is reduced to a host, and this site's own pages are not referrers", () => {
  assert.equal(referrerHost("https://www.google.com/search?q=secret", "tline.example"), "google.com");
  assert.equal(referrerHost("https://tline.example/research/1", "tline.example"), null);
  assert.equal(referrerHost("https://www.tline.example/x", "tline.example"), null);
  assert.equal(referrerHost("not a url", "tline.example"), null);
});

test("one reader is one visitor within a day and a different one the next", () => {
  const today = visitorHash("203.0.113.7", "Chrome", "2026-09-07");
  assert.equal(visitorHash("203.0.113.7", "Chrome", "2026-09-07"), today);
  assert.notEqual(visitorHash("203.0.113.7", "Chrome", "2026-09-08"), today);
  assert.notEqual(visitorHash("203.0.113.8", "Chrome", "2026-09-07"), today);
});

test("the digest carries no recoverable trace of the address", () => {
  const hash = visitorHash("203.0.113.7", "Chrome", "2026-09-07");
  assert.equal(hash.includes("203"), false);
  assert.equal(hash.length, 32);
});

test("day keys are UTC and walk backwards correctly across a month boundary", () => {
  assert.equal(dayKey(new Date("2026-09-07T23:30:00Z")), "2026-09-07");
  assert.equal(shiftDay(new Date("2026-09-01T00:00:00Z"), -1), "2026-08-31");
  const week = dayRange(7, new Date("2026-09-07T12:00:00Z"));
  assert.equal(week.length, 7);
  assert.equal(week[0], "2026-09-01");
  assert.equal(week.at(-1), "2026-09-07");
});
