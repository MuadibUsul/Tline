import assert from "node:assert/strict";
import test from "node:test";
import keywords from "../../data/seo-keywords.json";
import { TITLE_MAX } from "./seo";
import { assetSeoProfile, institutionSeoProfile, subjectInstitutionSeoProfile } from "./seoLanding";

test("priority asset profiles are unique, localized and bounded", () => {
  const tickers = ["XAUUSD", "WTI", "EURUSD", "US10Y", "DXY", "NDX"];
  for (const locale of ["en", "zh-CN"] as const) {
    const profiles = tickers.map((ticker) => assetSeoProfile(ticker, ticker, locale, 7, 12));
    assert.equal(new Set(profiles.map((profile) => profile.title)).size, profiles.length);
    for (const profile of profiles) {
      assert.ok(profile.title.length <= TITLE_MAX);
      assert.match(profile.h1, /7/);
      assert.match(profile.description, /12/);
    }
  }
  assert.doesNotMatch(assetSeoProfile("WTI", "Crude Oil (WTI)", "en", 4, 8).title, /Brent/i);
});

test("institution and subject profiles use measured coverage", () => {
  assert.match(institutionSeoProfile("westpac", "Westpac / Westpac IQ", "en", 15).h1, /15/);
  assert.match(institutionSeoProfile("wellington-management", "惠灵顿管理", "zh-CN", 1).description, /1篇/);
  const fed = subjectInstitutionSeoProfile("federal-reserve", "Federal Reserve", "en", 54, 23);
  assert.match(fed.h1, /23/);
  assert.match(fed.description, /54/);
});

test("keyword map has one target per intent and keeps unsupported entities unmapped", () => {
  assert.ok(keywords.length >= 30 && keywords.length <= 50);
  const targets = new Map<string, Set<string>>();
  for (const row of keywords) {
    if (!row.target_url) continue;
    const key = `${row.language}:${row.topic}:${row.intent}`;
    const set = targets.get(key) ?? new Set<string>();
    set.add(row.target_url);
    targets.set(key, set);
  }
  for (const [key, pages] of targets) assert.equal(pages.size, 1, key);
  for (const row of keywords.filter((item) => /brent|布伦特|nomura chip|野村芯片/i.test(item.keyword))) {
    assert.equal(row.target_url, "", `${row.keyword} must stay a content gap until local evidence exists`);
  }
});
