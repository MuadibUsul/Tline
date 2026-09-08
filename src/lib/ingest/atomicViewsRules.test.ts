import assert from "node:assert/strict";
import test from "node:test";
import { extractAtomicViewsByRule, splitSentences } from "./atomicViewsRules";

test("an abbreviation does not end a sentence", () => {
  // Splitting on every period quotes half a claim, which is both wrong and unquotable.
  const parts = splitSentences("U.S. GDP should rise 2.4% in 2026. Demand is firm.");
  assert.equal(parts.length, 2);
  assert.match(parts[0], /^U\.S\. GDP/);
});

test("a view is the article's own sentence, so its quote cannot disagree with it", () => {
  const article = "Overview. We expect gold to reach $5,000 by year-end 2026 as demand stays firm. The weather was fine.";
  const [view] = extractAtomicViewsByRule(article);
  assert.equal(view.viewEn, view.sourceQuote);
  assert.equal(article.includes(view.sourceQuote), true);
});

test("direction comes from the wording, and a two-sided sentence is not a call", () => {
  const bullish = extractAtomicViewsByRule("We expect the index to rally 12% through 2026 on stronger demand.");
  assert.equal(bullish[0].direction, "bullish");
  const both = extractAtomicViewsByRule("We expect a 4% rally if demand improves, but a downgrade would follow weaker exports.");
  assert.equal(both[0].direction, "conditional");
});

test("hedged language is recorded as lower confidence", () => {
  const [hedged] = extractAtomicViewsByRule("Inflation could fall to 2.1% in 2027, though the path may be uneven.");
  assert.equal(hedged.confidence, "low");
});

test("background prose is left out", () => {
  // No stance and no figure: narration, not a view.
  assert.deepEqual(extractAtomicViewsByRule("The conference was held in Frankfurt and was attended by delegates."), []);
});

test("type and importance are not guessed", () => {
  const [view] = extractAtomicViewsByRule("We forecast Brent averaging $78 per barrel over 2026 on tighter supply.");
  assert.equal(view.type, "unclassified");
  assert.equal(view.importance, 3);
});

test("a running header is not a view", () => {
  // Real extraction output: the publication's page header, glued to the sentence that
  // began that page once the line breaks were stripped.
  const header = "Article | 7 September 2026 1 THINK Economic and financial analysis Article | 7 September 2026 COMMODITIES DAILY oil should rise 3%.";
  assert.deepEqual(extractAtomicViewsByRule(header), []);
});
