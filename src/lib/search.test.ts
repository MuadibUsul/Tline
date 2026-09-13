import assert from "node:assert/strict";
import test from "node:test";
import { matchingSnippet, rankSearchCandidates, type SearchCandidate } from "./search";

const candidates: SearchCandidate[] = [
  {
    result: { id: "goldman", kind: "institution", title: "Goldman Sachs", subtitle: "US", href: "/institution/goldman-sachs" },
    primary: ["Goldman Sachs"],
  },
  {
    result: { id: "gold", kind: "asset", title: "Gold · XAUUSD", subtitle: "commodity", href: "/markets/gold" },
    primary: ["Gold", "XAUUSD"],
    aliases: ["gold price", "黄金", "金价"],
  },
  {
    result: { id: "article", kind: "article", title: "Gold outlook", subtitle: "Goldman Sachs", href: "/research/article" },
    primary: ["Gold outlook", "黄金展望"],
    secondary: ["Goldman Sachs"],
    content: ["The bank raised its bullion forecast.", "该行上调黄金预测。"],
  },
  {
    result: { id: "noise", kind: "institution", title: "Société Générale", subtitle: "FR", href: "/institution/noise" },
    primary: ["Société Générale", "soci-t-g-n-rale"],
  },
];

test("fuzzy search handles typos, aliases, bilingual text and field combinations", () => {
  assert.equal(rankSearchCandidates("gldman", candidates)[0]?.id, "goldman");
  assert.equal(rankSearchCandidates("金价", candidates)[0]?.id, "gold");
  assert.equal(rankSearchCandidates("黄金展望", candidates)[0]?.id, "article");
  assert.equal(rankSearchCandidates("Goldman outlook", candidates)[0]?.id, "article");
});

test("content matches return the relevant highlighted excerpt", () => {
  const exact = matchingSnippet(["Unrelated summary.", "Policy remains restrictive because inflation is persistent."], "inflation");
  assert.match(exact?.text ?? "", /inflation/i);
  assert.equal(exact?.match.toLowerCase(), "inflation");

  const fuzzy = rankSearchCandidates("forecat", candidates);
  assert.equal(fuzzy[0]?.id, "article");
  assert.equal(fuzzy[0]?.matchKind, "content");
  assert.equal(fuzzy[0]?.snippetMatch, "forecast");
});

const withViews: SearchCandidate[] = [
  ...candidates,
  ...[1, 2, 3].map((n) => ({
    result: {
      id: `view-${n}`,
      kind: "view" as const,
      articleId: "article",
      title: `黄金在避险需求下走高 ${n}`,
      subtitle: "Goldman Sachs · 黄金",
      href: "/research/article",
    },
    primary: [`Gold rallies on haven demand ${n}`, `黄金在避险需求下走高 ${n}`],
    aliases: ["黄金", "XAUUSD"],
  })),
  {
    result: { id: "view-other", kind: "view" as const, articleId: "other", title: "黄金承压", subtitle: "UBS · 黄金", href: "/research/other" },
    primary: ["Gold under pressure", "黄金承压"],
    aliases: ["黄金", "XAUUSD"],
  },
];

test("extracted views are searchable in their own right", () => {
  const results = rankSearchCandidates("黄金", withViews);
  assert.ok(results.some((result) => result.kind === "view"), "a view should surface for an asset query");
  assert.ok(results.some((result) => result.kind === "article"), "reports should still surface alongside views");
});

test("one report cannot fill the list with its own views", () => {
  const results = rankSearchCandidates("黄金", withViews);
  const fromOneArticle = results.filter((result) => result.kind === "view" && result.articleId === "article");
  assert.ok(fromOneArticle.length <= 2, `expected at most 2 views from one report, got ${fromOneArticle.length}`);
  assert.ok(results.some((result) => result.id === "view-other"), "a view from another report should still get through");
});

test("an asset still outranks the views that mention it", () => {
  assert.equal(rankSearchCandidates("黄金", withViews)[0]?.id, "gold");
});

test("normalized candidate data is reused across type-ahead queries", () => {
  rankSearchCandidates("gold", candidates);
  const normalized = candidates[0].normalizedPrimary;
  const trigrams = candidates[0].combinedTrigrams;

  rankSearchCandidates("gldman", candidates);
  assert.strictEqual(candidates[0].normalizedPrimary, normalized);
  assert.strictEqual(candidates[0].combinedTrigrams, trigrams);
});
