import assert from "node:assert/strict";
import test from "node:test";
import { clusterViewsNewestFirst, rankAtomicViews, type MarketEvent, type RankableView } from "./viewRanking";

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

test("only views published within the latest seven days are returned", () => {
  const ranked = rankAtomicViews([view("boundary", "Gold", "a", 4, 0.85, 7 * 24), view("old", "Oil", "b", 4, 0.85, 7 * 24 + 1), view("future", "Rates", "c", 4, 0.85, -1)], now);
  assert.deepEqual(ranked.map((item) => item.id), ["boundary"]);
});

test("wire is newest-first with same-topic views grouped together", () => {
  const enriched = rankAtomicViews([
    view("gold-new", "Gold", "a", 4, 0.85, 1),
    view("oil", "Oil", "b", 4, 0.85, 2),
    view("gold-old", "Gold", "c", 4, 0.85, 5),
  ], now);
  // Gold cluster (newest member 1h ago) leads, its members newest-first, then Oil.
  assert.deepEqual(clusterViewsNewestFirst(enriched).map((item) => item.id), ["gold-new", "gold-old", "oil"]);
});

test("views matching the same active event cluster together", () => {
  const event: MarketEvent = { id: "jh", titleEn: "Jackson Hole", titleZh: "杰克逊霍尔", activeFrom: "2026-08-27T00:00:00Z", activeUntil: "2026-08-29T00:00:00Z", keywords: ["Warsh"], tickers: [], sourceUrl: "https://example.com" };
  const a = { ...view("warsh-a", "Rates", "a", 4, 0.85, 3), viewEn: "Warsh turns hawkish" };
  const b = { ...view("warsh-b", "Equities", "b", 4, 0.85, 6), viewEn: "Warsh remarks move stocks" };
  const other = view("gold", "Gold", "c", 4, 0.85, 1);
  const arranged = clusterViewsNewestFirst(rankAtomicViews([a, b, other], now, [event]));
  // Gold is newest (1h) so leads; the two event views stay adjacent, newest-first.
  assert.deepEqual(arranged.map((item) => item.id), ["gold", "warsh-a", "warsh-b"]);
});
