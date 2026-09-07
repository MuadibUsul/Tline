import assert from "node:assert/strict";
import test from "node:test";
import { localeFromPath, localePath, stripLocale } from "./i18n";

test("a path states its own locale", () => {
  assert.equal(localeFromPath("/zh/research"), "zh-CN");
  assert.equal(localeFromPath("/en/research/abc"), "en");
  assert.equal(localeFromPath("/zh"), "zh-CN");
  // Nothing to go on: these carry no locale and must not be read as one.
  assert.equal(localeFromPath("/research"), null);
  assert.equal(localeFromPath("/"), null);
  assert.equal(localeFromPath("/english/report"), null);
});

test("a page can be addressed in either language", () => {
  assert.equal(localePath("zh-CN", "/research"), "/zh/research");
  assert.equal(localePath("en", "/research"), "/en/research");
  assert.equal(localePath("zh-CN", "/"), "/zh");
  assert.equal(localePath("en", "/research/abc123"), "/en/research/abc123");
});

test("switching language replaces the prefix rather than stacking another", () => {
  // The toggle rewrites the address it is on; doing that twice must not yield /en/zh/…
  assert.equal(localePath("en", "/zh/research/abc"), "/en/research/abc");
  assert.equal(localePath("zh-CN", "/en/research/abc"), "/zh/research/abc");
  assert.equal(localePath("zh-CN", "/zh/macro"), "/zh/macro");
});

test("an address that is not ours is left alone", () => {
  assert.equal(localePath("zh-CN", "https://bank.example/report"), "https://bank.example/report");
  assert.equal(localePath("zh-CN", "#section"), "#section");
});

test("machine endpoints never gain duplicate locale addresses", () => {
  assert.equal(localePath("zh-CN", "/api/documents/abc"), "/api/documents/abc");
  assert.equal(localePath("en", "/_next/image"), "/_next/image");
});

test("a prefixed address still matches the route it would redirect to", () => {
  // The password gate compares the address against "/account/password". The header
  // carries the prefix, so without stripping it the gate redirects a reader onto the
  // page they are already on, forever.
  assert.equal(stripLocale("/zh/account/password"), "/account/password");
  assert.equal(stripLocale("/en/account/password"), "/account/password");
  assert.equal(stripLocale("/account/password"), "/account/password");
  assert.equal(stripLocale("/zh"), "/");
  assert.equal(stripLocale("/"), "/");
  // A path segment that merely begins with a language name is not a prefix.
  assert.equal(stripLocale("/entities/abc"), "/entities/abc");
});
