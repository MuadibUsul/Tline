import assert from "node:assert/strict";
import test from "node:test";
import { assetName, domainTerm, institutionName, localizeChineseContent, localizedDataValue, localeSafeText, resolveLocale, tr } from "./i18n";

test("resolves an explicit locale before browser language", () => {
  assert.equal(resolveLocale("en", "zh-CN,zh;q=0.9"), "en");
  assert.equal(resolveLocale("zh-CN", "en-US"), "zh-CN");
  assert.equal(resolveLocale(undefined, "zh-CN,zh;q=0.9"), "zh-CN");
  assert.equal(resolveLocale(undefined, "en-US,en;q=0.9"), "en");
  assert.equal(tr("zh-CN", "Research", "研报"), "研报");
});

test("localizes canonical institution, asset and domain names without contaminating English", () => {
  assert.equal(institutionName("Goldman Sachs", "zh-CN"), "高盛");
  assert.equal(institutionName("goldman-sachs", "zh-CN"), "高盛");
  assert.equal(institutionName("Goldman Sachs", "en"), "Goldman Sachs");
  assert.equal(assetName("Gold", "zh-CN", "XAUUSD"), "黄金");
  assert.equal(assetName("Gold", "en", "XAUUSD"), "Gold");
  assert.equal(domainTerm("market_impact", "zh-CN"), "市场影响");
  assert.equal(localeSafeText("黄金主线", "en", "Custom theme"), "Custom theme");
  assert.equal(localizedDataValue("September hike unlikely", "zh-CN"), null);
  assert.equal(localizedDataValue("USD 503bn", "zh-CN"), "USD 503bn");
  assert.equal(localizeChineseContent("Isabel Schnabel at Westpac IQ"), "伊莎贝尔·施纳贝尔 at 西太平洋银行研究平台");
});
