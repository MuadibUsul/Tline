import assert from "node:assert/strict";
import test from "node:test";
import { rankAtomicViews, type RankableView } from "./viewRanking";

const now = new Date("2026-08-28T12:00:00.000Z");
function view(id: string, asset: string, institutionId: string, rating: number, authorityScore: number, hoursAgo: number): RankableView {
  return { id, articleId: `article-${id}`, asset, assetTicker: null, topic: asset, viewEn: asset, viewZh: asset, importance: 4,
    article: { publishedAt: new Date(now.getTime() - hoursAgo * 36e5), institutionId, institution: { rating, authorityScore } } };
}

test("asset heat outranks institution authority", () => {
  const ranked = rankAtomicViews([
    view("hot-small", "Gold", "small", 3, 0.7, 5),
    view("hot-peer", "Gold", "peer", 3, 0.7, 6),
    view("cold-large", "Copper", "large", 5, 1, 1),
  ], now);
  assert.equal(ranked[0].asset, "Gold");
  assert.ok(ranked[0].heatScore > ranked.find((item) => item.id === "cold-large")!.heatScore);
});

test("authority outranks freshness when heat is equal", () => {
  const ranked = rankAtomicViews([view("large-old", "Gold", "large", 5, 1, 20), view("small-new", "Copper", "small", 3, 0.7, 1)], now);
  assert.equal(ranked[0].id, "large-old");
});

test("freshness breaks ties between equally weighted institutions", () => {
  const ranked = rankAtomicViews([view("old", "Gold", "a", 4, 0.85, 20), view("new", "Copper", "b", 4, 0.85, 1)], now);
  assert.equal(ranked[0].id, "new");
});

test("an active market event receives the largest heat boost", () => {
  const event = { id: "event", titleEn: "Jackson Hole", titleZh: "杰克逊霍尔", activeFrom: "2026-08-27T00:00:00Z", activeUntil: "2026-08-29T00:00:00Z", keywords: ["Warsh"], tickers: [], sourceUrl: "https://example.com" };
  const eventView = { ...view("event", "Rates", "small", 3, 0.7, 5), viewEn: "Warsh speaks at Jackson Hole" };
  assert.equal(rankAtomicViews([eventView, view("other", "Gold", "large", 5, 1, 1)], now, [event])[0].id, "event");
});
