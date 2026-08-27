import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocale, tr } from "./i18n";

test("resolves an explicit locale before browser language", () => {
  assert.equal(resolveLocale("en", "zh-CN,zh;q=0.9"), "en");
  assert.equal(resolveLocale("zh-CN", "en-US"), "zh-CN");
  assert.equal(resolveLocale(undefined, "zh-CN,zh;q=0.9"), "zh-CN");
  assert.equal(resolveLocale(undefined, "en-US,en;q=0.9"), "en");
  assert.equal(tr("zh-CN", "Research", "研报"), "研报");
});
