import assert from "node:assert/strict";
import test from "node:test";
import { heuristicParse, type ParseInput } from "./parseLLM";
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
