import assert from "node:assert/strict";
import test from "node:test";
import { languageSwitchTarget } from "./languageSwitch";

test("language switch follows the current page, not the page the reader first landed on", () => {
  assert.deepEqual(languageSwitchTarget("/zh", "zh-CN"), { href: "/en", hrefLang: "en" });
  assert.deepEqual(languageSwitchTarget("/zh/research", "zh-CN"), { href: "/en/research", hrefLang: "en" });
  assert.deepEqual(
    languageSwitchTarget("/zh/research/westpac-weekly", "zh-CN"),
    { href: "/en/research/westpac-weekly", hrefLang: "en" },
  );
  assert.deepEqual(languageSwitchTarget("/en/news", "en"), { href: "/zh/news", hrefLang: "zh-CN" });
  assert.deepEqual(languageSwitchTarget("/en", "en"), { href: "/zh", hrefLang: "zh-CN" });
});

test("the console has no language switch, and a locale-less path falls back to the root", () => {
  assert.equal(languageSwitchTarget("/admin/design-system", "zh-CN"), null);
  assert.deepEqual(languageSwitchTarget("/watchlist", "zh-CN"), { href: "/en", hrefLang: "en" });
  assert.deepEqual(languageSwitchTarget("/watchlist", "en"), { href: "/zh", hrefLang: "zh-CN" });
});
