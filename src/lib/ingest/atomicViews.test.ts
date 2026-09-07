import assert from "node:assert/strict";
import test from "node:test";
import { validateAtomicViews, validateAtomicViewYield } from "./atomicViews";

const valid = {
  view_en: "Test Bank expects gold to reach $5,000 by year-end.",
  view_zh: "测试银行预计黄金将在年底前达到5,000美元。",
  type: "target", asset: "Gold", asset_ticker: "XAUUSD", topic: "precious metals",
  direction: "bullish", time_horizon: "year-end 2026", value: "$5,000",
  condition_en: null, condition_zh: null, rationale_en: null, rationale_zh: null,
  confidence: "high", importance: 5,
  source_quote: "We expect gold to reach $5,000 by year-end 2026.",
};

test("accepts an atomic view with a direct supporting quote", () => {
  const result = validateAtomicViews([valid], "Outlook\nWe expect gold to reach $5,000 by year-end 2026. Demand remains firm.");
  assert.equal(result.length, 1);
  assert.equal(result[0].assetTicker, "XAUUSD");
});

test("drops views whose source quote was invented", () => {
  assert.deepEqual(validateAtomicViews([valid], "Gold demand remains firm."), []);
});

test("drops values containing a number unsupported by the quote", () => {
  const altered = { ...valid, value: "$6,000" };
  assert.deepEqual(validateAtomicViews([altered], valid.source_quote), []);
});

test("deduplicates identical views and rejects invalid labels", () => {
  const bad = { ...valid, direction: "very_bullish" };
  assert.equal(validateAtomicViews([valid, { ...valid }, bad], valid.source_quote).length, 1);
});

test("drops a view that turns qualified language into certainty", () => {
  const qualified = {
    ...valid,
    view_en: "Test Bank says gold will reach $5,000 by year-end.",
    source_quote: "Gold is likely to reach $5,000 by year-end.",
  };
  assert.deepEqual(validateAtomicViews([qualified], qualified.source_quote), []);
});

test("does not label another central bank as the Federal Reserve", () => {
  const boc = { ...valid, asset: "Bank of Canada policy", asset_ticker: "FED", topic: "central bank", view_en: "The Bank of Canada is expected to hold rates.", view_zh: "加拿大央行预计将维持利率不变。", value: null, source_quote: "The Bank of Canada is expected to hold rates." };
  assert.equal(validateAtomicViews([boc], boc.source_quote)[0]?.assetTicker, null);
});

test("drops policy claims and Chinese additions unsupported by the quote", () => {
  const quote = "We must be confident that underlying inflation is moving to our objective, clearly and at sufficient speed; otherwise, we have work to do.";
  const unsupported = { ...valid, view_en: "The Fed is inclined to hike unless the labor market weakens.", view_zh: "美联储倾向加息，除非劳动力市场恶化。", asset: "Federal Reserve policy", asset_ticker: "FED", topic: "monetary policy", value: null, source_quote: quote };
  const inventedChinese = { ...valid, view_en: "The bank expects gold to reach $5,000 by year-end.", view_zh: "测试银行预计失业率上升后黄金将在年底前达到5,000美元。" };
  assert.deepEqual(validateAtomicViews([unsupported], quote), []);
  assert.deepEqual(validateAtomicViews([inventedChinese], valid.source_quote), []);
});

test("a quote whose punctuation the model retyped still matches the article", () => {
  // Publisher bodies carry typographic punctuation — thirty-five of forty sampled
  // articles contained curly apostrophes. A model reproducing the sentence writes the
  // straight form, which used to fail the containment check and discard a faithful
  // quotation along with the whole view it supported.
  const article = "Outlook. The bank’s view — gold to reach $5,000 – remains unchanged. Demand is firm.";
  const view = {
    ...valid,
    view_en: "The bank expects gold to reach $5,000.",
    view_zh: "该行预计黄金将达到5,000美元。",
    value: "$5,000",
    source_quote: "The bank's view - gold to reach $5,000 - remains unchanged.",
  };
  assert.equal(validateAtomicViews([view], article).length, 1);
});

test("the yield report names why each view was dropped", () => {
  // The counts exist to answer whether the validator is discarding work already paid for:
  // output tokens are billed on what the model wrote, not on what survived.
  const invented = { ...valid, source_quote: "A sentence that is not in the article." };
  const yielded = validateAtomicViewYield([valid, invented], valid.source_quote);
  assert.equal(yielded.proposed, 2);
  assert.equal(yielded.kept, 1);
  assert.deepEqual(yielded.rejected, { quote_not_in_source: 1 });
});
