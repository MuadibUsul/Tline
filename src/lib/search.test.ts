import assert from "node:assert/strict";
import test from "node:test";
import { rankSearchCandidates, type SearchCandidate } from "./search";

const candidates: SearchCandidate[] = [
  {
    result: { id: "goldman", kind: "institution", title: "Goldman Sachs", subtitle: "US", href: "/institution/goldman-sachs" },
    primary: ["Goldman Sachs"],
  },
  {
    result: { id: "gold", kind: "asset", title: "Gold · XAUUSD", subtitle: "commodity", href: "/asset/XAUUSD" },
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
