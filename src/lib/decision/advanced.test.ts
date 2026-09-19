import assert from "node:assert/strict";
import test from "node:test";
import { buildSourceConsistencyRequest, consistencyFingerprint } from "./consistency";
import { buildPolicyIntelligenceRequest } from "./policy-intelligence";
import { buildSemanticRelevanceRequest } from "./relevance";
import { buildViewChangeRequest } from "./view-change";
import type { ParsedPolicyDocument } from "../macro/policy/types";

const policy: ParsedPolicyDocument = {
  decision: "HOLD", targetRateLower: 4, targetRateUpper: 4.25, changeBps: 0,
  stance: "NEUTRAL", inflationAssessment: "Inflation remains elevated.", growthAssessment: "Growth is solid.",
  laborAssessment: "Employment gains moderated.", forwardGuidance: "Data dependent.", balanceSheetAction: "",
  votesFor: 12, votesAgainst: 0, sourceQuotes: [], confidence: 0.9,
};

test("source consistency is source-bounded and fingerprinted by source plus generated output", () => {
  const input = {
    contentId: "article-1",
    source: { title: "Outlook", text: "Inflation declined to 2.5%.", contentHash: "source-hash" },
    generated: { summary: "Inflation declined.", keyNumbers: [{ value: "2.5%" }] },
  };
  const request = buildSourceConsistencyRequest(input);
  assert.equal(request.decisionType, "analysis.source-consistency.shadow");
  assert.equal(request.audit?.contentId, "article-1");
  assert.equal(request.audit?.requestFingerprint, consistencyFingerprint(input));
  assert.ok("unsupportedNumber" in request.questions);
  assert.match(JSON.stringify(request.state), /Do not use outside knowledge/);
});

test("policy intelligence supports any central bank and compares only supplied versions", () => {
  const request = buildPolicyIntelligenceRequest({
    contentId: "ecb-current", centralBank: "ECB",
    current: { id: "ecb-current", contentHash: "current", publishedAt: "2026-09-20", parsed: policy },
    previous: { id: "ecb-previous", contentHash: "previous", publishedAt: "2026-08-01", parsed: { ...policy, stance: "DOVISH" } },
  });
  assert.equal(request.decisionType, "policy.intelligence.shadow");
  assert.equal((request.state as { centralBank: string }).centralBank, "ECB");
  assert.deepEqual(Object.keys(request.questions).includes("becameMoreHawkish"), true);
  assert.equal(request.questions.policyBias.type, "choice");
});

test("view change requires two real, distinct database views", () => {
  const view = { id: "old", articleId: "article-old", publishedAt: "2026-08-01", view: "No more hikes", direction: "neutral", type: "forecast", value: null, timeHorizon: "3M", sourceQuote: "We expect no more hikes." };
  const request = buildViewChangeRequest({
    contentId: "article-new", institutionId: "publisher-1", jurisdiction: "us", topic: "monetary-policy",
    previous: view,
    current: { ...view, id: "new", articleId: "article-new", publishedAt: "2026-09-01", view: "Another hike is possible", direction: "bearish", sourceQuote: "Another hike remains possible." },
  });
  assert.equal(request.decisionType, "atomic-view.change.shadow");
  assert.throws(() => buildViewChangeRequest({
    contentId: "article-old", institutionId: "publisher-1", jurisdiction: "us", topic: "monetary-policy",
    previous: view, current: view,
  }), /distinct historical and current/);
});

test("watchlist relevance is interface-only and keeps materiality separate from keyword matching", () => {
  const request = buildSemanticRelevanceRequest({
    contentId: "article-1", watch: { jurisdictions: ["us"], topics: ["inflation"] },
    candidate: { title: "Weekly markets", excerpt: "CPI is mentioned in passing." }, requestFingerprint: "watch-fp",
  });
  assert.equal(request.decisionType, "watchlist.semantic-relevance.shadow");
  assert.deepEqual(Object.keys(request.questions), ["materiallyRelevant", "requiresReview"]);
});
