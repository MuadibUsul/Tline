import assert from "node:assert/strict";
import test from "node:test";
import { buildTradingThemes, type ThemeView } from "./tradingThemes";

const now = new Date("2026-09-13T00:00:00Z");
const view = (id: string, topic: string, direction: string, daysAgo: number, institutionId: string): ThemeView => ({
  id, articleId: id, topic, direction, importance: 4, asset: "Gold", assetTicker: "XAUUSD",
  viewEn: `${topic} supports gold`, viewZh: `${topic}支持黄金`, rationaleEn: "Policy transmission", rationaleZh: "政策传导", conditionEn: null, conditionZh: null,
  article: { slug: id, title: topic, publishedAt: new Date(now.getTime() - daysAgo * 864e5), institutionId, institution: { slug: institutionId, name: institutionId, rating: 5, authorityScore: 1 } },
});

test("merges synonymous topics and identifies cross-institution strengthening", () => {
  const themes = buildTradingThemes([
    view("a", "Inflation", "bullish", 1, "bank-a"),
    view("b", "inflation drivers", "bullish", 2, "bank-b"),
    view("old", "Inflation Risk", "bearish", 9, "bank-a"),
  ], now, [{ symbol: "XAUUSD", changePct: 1.2 }]);
  assert.equal(themes[0].key, "inflation");
  assert.equal(themes[0].institutionCount, 2);
  assert.equal(themes[0].status, "strengthening");
  assert.equal(themes[0].assets[0].marketConfirmed, true);
});
