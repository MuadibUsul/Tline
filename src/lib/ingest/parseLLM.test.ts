import assert from "node:assert/strict";
import test from "node:test";
import { coerceModelResponse, heuristicParse, selectAnalysisEvidence, type ParseInput } from "./parseLLM";
import type { Segment } from "./extract";

const input = (title: string, text: string): ParseInput => ({
  institution: "Test Bank",
  title,
  text,
  publishedAt: "2026-08-27T00:00:00.000Z",
});

test("assigns independent directions from headed asset segments", () => {
  const segments: Segment[] = [
    { heading: "Gold outlook", text: "We are strongly bullish on gold and see significant upside for bullion." },
    { heading: "Oil outlook", text: "We are bearish on oil as crude inventories rise and demand weakens." },
  ];
  const parsed = heuristicParse(input("Commodity outlook", segments.map((s) => s.text).join("\n")), segments);
  assert.deepEqual(parsed.assets.map((a) => [a.ticker, a.direction]), [["XAUUSD", 2], ["WTI", -1]]);
  assert.equal(parsed.needsLLM, false);
});

test("withholds an asset when headed segments conflict", () => {
  const segments: Segment[] = [
    { heading: "Gold support", text: "We are bullish on gold and expect upside." },
    { heading: "Gold risks", text: "We are bearish on gold if real yields rise." },
  ];
  const parsed = heuristicParse(input("Gold scenarios", segments.map((s) => s.text).join("\n")), segments);
  assert.equal(parsed.assets.length, 0);
  assert.deepEqual(parsed.unresolvedTickers, ["XAUUSD"]);
  assert.equal(parsed.reviewStatus, "needs_review");
});

test("without headings only assigns the main asset", () => {
  const text = "We are bullish on gold and expect upside for bullion. Oil and crude are also discussed as background risks.";
  const parsed = heuristicParse(input("Gold outlook with oil risks", text));
  assert.deepEqual(parsed.assets.map((a) => a.ticker), ["XAUUSD"]);
  assert.deepEqual(parsed.unresolvedTickers, ["WTI"]);
});

test("single-asset articles keep a deterministic signal", () => {
  const text = "We raise our gold target from $4,700 to $4,900. A bullish setup persists as demand for bullion stays strong.";
  const parsed = heuristicParse(input("Gold: lifting target to $4,900", text));
  assert.equal(parsed.assets[0]?.ticker, "XAUUSD");
  assert.equal(parsed.assets[0]?.direction, 1);
  assert.equal(parsed.assets[0]?.previousTarget, 4700);
  assert.equal(parsed.assets[0]?.target, 4900);
  assert.equal(parsed.reviewStatus, "ok");
});

test("a mention without directional evidence is not neutral", () => {
  const parsed = heuristicParse(input("Gold market update", "Gold prices were discussed alongside bullion market volumes and positioning data."));
  assert.equal(parsed.assets.length, 0);
  assert.deepEqual(parsed.unresolvedTickers, ["XAUUSD"]);
});

test("does not treat years or ordinary dollar amounts as price targets", () => {
  const text = "AI capex may reach $100bn in 2027. We remain bullish on semiconductors, while a scenario sees costs move from $100 to $230.";
  const parsed = heuristicParse(input("Semiconductor outlook", text));
  assert.equal(parsed.assets[0]?.ticker, "SOX");
  assert.equal(parsed.assets[0]?.target, null);
  assert.equal(parsed.assets[0]?.previousTarget, null);
});

test("does not assign another commodity's target to the detected asset", () => {
  const text = "We remain bullish on copper as supply tightens. The price of aluminum is forecasted to reach $3,800 per metric ton.";
  const parsed = heuristicParse(input("Metals Outlook: Copper, Steel and Aluminum", text));
  assert.equal(parsed.assets[0]?.ticker, "COPPER");
  assert.equal(parsed.assets[0]?.target, null);
});

test("rejects a one-word provider response instead of publishing it as analysis", () => {
  const parsed = coerceModelResponse({ summary_en: "Schroders", summary_zh: "施罗德", atomic_views: [] }, "test", "test", "Global equities gained in August.");
  assert.equal(parsed, null);
});

test("code-selected evidence keeps distant facts and risks within its budget", () => {
  const filler = Array.from({ length: 180 }, (_, index) => `Background paragraph ${index} describes ordinary market history without a decision.`);
  filler[90] = "Our forecast is 3.2% growth in 2027 because demand should recover, but it could fall to 2.1% if policy remains tight.";
  const selected = selectAnalysisEvidence(input("Growth outlook and policy risks", filler.join(" ")), 2_000);
  assert.ok(selected.length <= 2_000);
  assert.match(selected, /3\.2% growth/);
  assert.match(selected, /could fall to 2\.1% if policy remains tight/);
});
