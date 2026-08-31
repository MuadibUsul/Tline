import assert from "node:assert/strict";
import test from "node:test";
import type { LLMProvider } from "../../llm/provider";
import { discoverFomcPolicyDocuments } from "./fetch";
import { extractPolicyText } from "./extract";
import { extractDeterministicPolicy, parsePolicyDocument } from "./parse";

const HISTORICAL_STATEMENTS = [
  {
    date: "2023-07-26",
    text: `The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to 5-1/4 to 5-1/2 percent.

Voting for the monetary policy action were Jerome H. Powell, John C. Williams, and Christopher J. Waller.`,
    expected: { decision: "HIKE", lower: 5.25, upper: 5.5, bps: 25, against: 0 },
  },
  {
    date: "2024-09-18",
    text: `The Committee decided to lower the target range for the federal funds rate by 1/2 percentage point to 4-3/4 to 5 percent.

Voting for the monetary policy action were Jerome H. Powell, John C. Williams, and Michael S. Barr. Voting against this action was Michelle W. Bowman, who preferred to lower the target range by 1/4 percentage point.`,
    expected: { decision: "CUT", lower: 4.75, upper: 5, bps: -50, against: 1 },
  },
  {
    date: "2025-01-29",
    text: `The Committee decided to maintain the target range for the federal funds rate at 4-1/4 to 4-1/2 percent.

Voting for the monetary policy action were Jerome H. Powell, John C. Williams, and Philip N. Jefferson.`,
    expected: { decision: "HOLD", lower: 4.25, upper: 4.5, bps: 0, against: 0 },
  },
];

test("deterministic extraction handles several historical FOMC statement fixtures", () => {
  for (const fixture of HISTORICAL_STATEMENTS) {
    const parsed = extractDeterministicPolicy(fixture.text);
    assert.equal(parsed.decision, fixture.expected.decision, fixture.date);
    assert.equal(parsed.targetRateLower, fixture.expected.lower, fixture.date);
    assert.equal(parsed.targetRateUpper, fixture.expected.upper, fixture.date);
    assert.equal(parsed.changeBps, fixture.expected.bps, fixture.date);
    assert.equal(parsed.votesAgainst, fixture.expected.against, fixture.date);
    assert.ok(parsed.sourceQuotes.length >= 3, fixture.date);
  }
});

test("a hold is not changed by a dissenter's preferred hike", () => {
  const parsed = extractDeterministicPolicy(`The Federal Open Market Committee approved the following statement for release by a 9 – 3 vote:

The Committee decided to maintain the target range for the federal funds rate at 3-1/2 to 3-3/4 percent.

Voting against the monetary policy action were Beth M. Hammack, Neel Kashkari, and Lorie K. Logan, who preferred to raise the target range for the federal funds rate by 1/4 percentage point.`);
  assert.equal(parsed.decision, "HOLD");
  assert.equal(parsed.changeBps, 0);
  assert.equal(parsed.votesFor, 9);
  assert.equal(parsed.votesAgainst, 3);
});

test("LLM semantics require exact quotes and cannot overwrite deterministic numbers", async () => {
  const text = `${HISTORICAL_STATEMENTS[2].text}\n\nInflation remains somewhat elevated. The Committee will carefully assess incoming data.`;
  const provider: LLMProvider = {
    name: "fixture",
    model: "fixture-model",
    async complete() {
      return {
        provider: this.name,
        model: this.model,
        text: JSON.stringify({
          decision: "CUT",
          targetRateLower: 1,
          targetRateUpper: 2,
          changeBps: -225,
          stance: "HAWKISH",
          forwardGuidance: "Invented guidance",
          inflationAssessment: "Inflation is elevated.",
          sourceQuotes: [
            { field: "stance", quote: "Inflation remains somewhat elevated." },
            { field: "inflationAssessment", quote: "Inflation remains somewhat elevated." },
            { field: "forwardGuidance", quote: "This sentence is not in the document." },
          ],
          confidence: 0.8,
        }),
      };
    },
  };
  const result = await parsePolicyDocument(text, provider);
  assert.equal(result.parsed.decision, "HOLD");
  assert.equal(result.parsed.targetRateLower, 4.25);
  assert.equal(result.parsed.changeBps, 0);
  assert.equal(result.parsed.stance, "HAWKISH");
  assert.equal(result.parsed.forwardGuidance, "");
  assert.equal(result.parsed.inflationAssessment, "Inflation is elevated.");
});

test("calendar discovery admits only official statement, implementation note and minutes HTML", () => {
  const html = `<div class="row fomc-meeting">
    <a href="/monetarypolicy/files/monetary20250129a1.pdf">PDF</a>
    <a href="/newsevents/pressreleases/monetary20250129a.htm">HTML</a>
    <a href="/newsevents/pressreleases/monetary20250129a1.htm">Implementation Note</a>
    <a href="https://example.com/foreign.htm">Foreign</a>
    <div class="fomc-meeting__minutes"><a href="/monetarypolicy/fomcminutes20250129.htm">HTML</a> (Released February 19, 2025)</div>
  </div>`;
  const rows = discoverFomcPolicyDocuments(html);
  assert.deepEqual(rows.map((row) => row.docType), ["STATEMENT", "IMPLEMENTATION_NOTE", "MINUTES"]);
  assert.equal(rows[2].publishedAt.toISOString(), "2025-02-19T00:00:00.000Z");
});

test("official HTML is reduced to substantive raw policy text", () => {
  const body = "The Committee decided to maintain the target range for the federal funds rate at 4-1/4 to 4-1/2 percent. Inflation remains somewhat elevated. The Committee will carefully assess incoming data and the evolving balance of risks.";
  const extracted = extractPolicyText(`<html><head><title>Federal Reserve statement</title></head><body><nav>Menu</nav><main><p>${body}</p></main><footer>Footer</footer></body></html>`);
  assert.equal(extracted.rawText, body);
});
