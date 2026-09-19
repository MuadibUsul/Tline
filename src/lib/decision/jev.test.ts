import assert from "node:assert/strict";
import test from "node:test";
import { decisionFingerprint, decisionRetryState, evaluateShadowLabels, summarizeShadowComparisons } from "./backfill";
import { buildClassificationShadowRequest, classificationDecisionPatch } from "./classification";
import { JevDecisionProvider } from "./jev";
import { runShadowDecision } from "./shadow";
import { buildRoutingShadowRequest, controlledGateAllowsSkip } from "./routing";
import type { DecisionCallRecord } from "./usage";
import type { DecisionProvider, DecisionRequest, DecisionResponse } from "./types";
import type { ClassificationResult } from "../classification/types";

const request: DecisionRequest = {
  decisionType: "content.classification",
  state: { title: "Policy outlook", metadata: { publisher: "Example institution" } },
  questions: {
    jurisdiction: {
      type: "choice",
      instructions: "Choose the primary jurisdiction.",
      criteria: { US: "United States", UNKNOWN: null },
    },
    policyRelevant: {
      type: "noul",
      instructions: "Is this materially relevant to monetary or fiscal policy?",
    },
  },
  audit: { classificationId: "classification-1", requestFingerprint: "fingerprint-1", baselineValue: "UNKNOWN" },
};

const successPayload = {
  model: "jev-latest",
  answers: {
    jurisdiction: { type: "choice", choice: "US", probabilities: { US: 0.8, UNKNOWN: 0.2 }, confidence: 0.8 },
    policyRelevant: { type: "noul", noul: 0.75 },
  },
  usage: { input_tokens: 21, output_tokens: 4 },
};

test("Jev provider sends only the official typed-decision payload and records safe telemetry", async () => {
  const records: DecisionCallRecord[] = [];
  let calls = 0;
  const provider = new JevDecisionProvider({
    apiKey: "test-key",
    fetchImpl: (async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://api.typesafe.ai/v1/systemone");
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-key");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(body).sort(), ["model", "questions", "state"]);
      assert.equal(body.model, "jev-latest");
      assert.equal(body.decisionType, undefined);
      assert.equal(body.audit, undefined);
      return new Response(JSON.stringify(successPayload), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
    recorder: async (record) => { records.push(record); },
  });

  const result = await provider.evaluate(request);

  assert.equal(calls, 1);
  assert.equal(result.answers.jurisdiction.type, "choice");
  assert.equal(records.length, 1);
  assert.equal(records[0].ok, true);
  assert.equal(records[0].classificationId, "classification-1");
  assert.equal(records[0].baselineValue, "UNKNOWN");
  assert.equal(records[0].inputTokens, 21);
  assert.equal(records[0].shadowMode, true);
  assert.doesNotMatch(JSON.stringify(records[0]), /test-key|Policy outlook|Example institution/);
});

test("Jev provider rejects untrusted answers and records the failed decision", async () => {
  const records: DecisionCallRecord[] = [];
  const invalidPayload = structuredClone(successPayload);
  invalidPayload.answers.jurisdiction.choice = "NOT_IN_CRITERIA";
  invalidPayload.answers.jurisdiction.confidence = 2;
  const provider = new JevDecisionProvider({
    apiKey: "test-key",
    fetchImpl: (async () => new Response(JSON.stringify(invalidPayload), { status: 200 })) as typeof fetch,
    recorder: async (record) => { records.push(record); },
  });

  await assert.rejects(provider.evaluate(request), /between 0 and 1|unknown choice/);
  assert.equal(records.length, 1);
  assert.equal(records[0].ok, false);
});

test("Jev provider leaves retry policy to the worker", async () => {
  const records: DecisionCallRecord[] = [];
  let calls = 0;
  const provider = new JevDecisionProvider({
    apiKey: "test-key",
    fetchImpl: (async () => {
      calls += 1;
      return new Response("rate limited", { status: 429 });
    }) as typeof fetch,
    recorder: async (record) => { records.push(record); },
  });

  await assert.rejects(provider.evaluate(request), /429/);
  assert.equal(calls, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].ok, false);
});

test("shadow runner is disabled by default flags and always fails open", async () => {
  let calls = 0;
  const provider: DecisionProvider = {
    name: "fake",
    model: "fake-model",
    async evaluate(): Promise<DecisionResponse> {
      calls += 1;
      throw new Error("provider unavailable");
    },
  };

  assert.deepEqual(await runShadowDecision(provider, request, { enabled: false }), {
    status: "DISABLED",
    reason: "JEV_DECISION_DISABLED",
  });
  assert.equal(calls, 0);

  assert.deepEqual(await runShadowDecision(provider, request, { enabled: true, shadowMode: false }), {
    status: "DISABLED",
    reason: "SHADOW_MODE_REQUIRED",
  });
  assert.equal(calls, 0);

  const failed = await runShadowDecision(provider, request, { enabled: true, shadowMode: true });
  assert.equal(failed.status, "FAILED");
  assert.equal(calls, 1);
});

test("shadow runner forces audit shadowMode without changing the baseline request", async () => {
  let received: DecisionRequest | undefined;
  const response: DecisionResponse = {
    provider: "fake",
    model: "fake-model",
    answers: {},
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  const provider: DecisionProvider = {
    name: "fake",
    model: "fake-model",
    async evaluate(value) {
      received = value;
      return response;
    },
  };

  const outcome = await runShadowDecision(provider, request, { enabled: true, shadowMode: true });
  assert.equal(outcome.status, "RECORDED");
  assert.equal(received?.audit?.shadowMode, true);
  assert.equal(request.audit?.shadowMode, undefined);
});

test("classification shadow requests are deterministic-first and preserve explicit unknown states", () => {
  const deterministic: ClassificationResult = {
    jurisdictionState: "UNKNOWN",
    primaryJurisdiction: null,
    relatedJurisdictions: [],
    institutions: [],
    topics: [],
    assets: [],
    assetClasses: [],
    events: [],
    contentType: "UNKNOWN",
    confidence: 0,
    source: "DETERMINISTIC",
  };
  const shadow = buildClassificationShadowRequest({
    document: { title: "Policy outlook", excerpt: "Extracted article text" },
    deterministic,
  });

  assert.ok(shadow);
  assert.deepEqual(Object.keys(shadow.questions), ["jurisdiction", "contentType", "primaryTopic"]);
  assert.equal(shadow.questions.jurisdiction.type, "choice");
  if (shadow.questions.jurisdiction.type === "choice") {
    assert.equal(shadow.questions.jurisdiction.criteria.UNKNOWN, null);
    assert.ok("MULTIPLE" in shadow.questions.jurisdiction.criteria);
    assert.ok("NONE" in shadow.questions.jurisdiction.criteria);
    assert.ok("NOT_APPLICABLE" in shadow.questions.jurisdiction.criteria);
  }

  const complete = { ...deterministic, jurisdictionState: "KNOWN" as const, primaryJurisdiction: "us" as const, contentType: "RESEARCH_ARTICLE" as const, topics: [{ key: "inflation" as const, confidence: 1 }] };
  assert.equal(buildClassificationShadowRequest({ document: { excerpt: "text" }, deterministic: complete }), null);
  assert.equal(buildClassificationShadowRequest({ document: { excerpt: "text" }, deterministic: { ...deterministic, source: "MANUAL" } }), null);
});

test("classification decisions apply only validated taxonomy choices above configured confidence", () => {
  const response: DecisionResponse = {
    provider: "jev", model: "jev-latest", usage: { inputTokens: 1, outputTokens: 1 },
    answers: {
      jurisdiction: { type: "choice", choice: "us", probabilities: { us: 0.95, UNKNOWN: 0.05 }, confidence: 0.95 },
      primaryTopic: { type: "choice", choice: "inflation", probabilities: { inflation: 0.92, UNKNOWN: 0.08 }, confidence: 0.92 },
    },
  };
  const accepted = classificationDecisionPatch(response, { reviewThreshold: 0.65, autoThreshold: 0.9 });
  assert.equal(accepted.status, "CLASSIFIED");
  assert.equal(accepted.jurisdiction?.primary, "us");
  assert.equal(accepted.primaryTopic?.key, "inflation");
  const low = structuredClone(response);
  if (low.answers.jurisdiction.type === "choice") low.answers.jurisdiction.confidence = 0.5;
  assert.equal(classificationDecisionPatch(low, { reviewThreshold: 0.65, autoThreshold: 0.9 }).accepted, false);
  const multiple = structuredClone(response);
  if (multiple.answers.jurisdiction.type === "choice") multiple.answers.jurisdiction.choice = "MULTIPLE";
  const unresolved = classificationDecisionPatch(multiple, { reviewThreshold: 0.65, autoThreshold: 0.9 });
  assert.equal(unresolved.jurisdiction, undefined);
  assert.equal(unresolved.status, "REVIEW");
});

test("routing decisions are shadow-shaped and cannot skip without explicit gate approval", () => {
  const request = buildRoutingShadowRequest({
    task: "analysis",
    title: "Outlook",
    excerpt: "Inflation is slowing.",
    policy: {
      executionLevel: "LEVEL_2", requiresLLM: true, requiresDecision: true, requiresFullText: false,
      reusableArtifact: false, contextStrategy: "SELECTIVE", reasonCodes: ["REQUIRES_DEEP_REASONING"], fingerprint: "fp",
    },
  });
  assert.equal(request.decisionType, "ai.execution.shadow");
  assert.equal(request.audit?.shadowMode, true);
  assert.equal(controlledGateAllowsSkip("analysis", { status: "FAILED", error: "offline" }), false);
});

test("controlled gate requires all approval flags, allowlist membership and confidence", () => {
  const before = {
    hard: process.env.LLM_HARD_GATE_ENABLED,
    approved: process.env.JEV_GATE_EVAL_APPROVED,
    tasks: process.env.AI_HARD_GATE_TASKS,
    threshold: process.env.JEV_GATE_MIN_CONFIDENCE,
  };
  process.env.LLM_HARD_GATE_ENABLED = "true";
  process.env.JEV_GATE_EVAL_APPROVED = "true";
  process.env.AI_HARD_GATE_TASKS = "retitle";
  process.env.JEV_GATE_MIN_CONFIDENCE = "0.95";
  const outcome = { status: "RECORDED" as const, result: {
    provider: "fake", model: "fake", usage: { inputTokens: 1, outputTokens: 1 },
    answers: { executionLevel: { type: "choice" as const, choice: "SKIP", probabilities: { SKIP: 0.96, LIGHT: 0.04 }, confidence: 0.96 } },
  } };
  try {
    assert.equal(controlledGateAllowsSkip("retitle", outcome), true);
    assert.equal(controlledGateAllowsSkip("analysis", outcome), false);
    outcome.result.answers.executionLevel.confidence = 0.9;
    assert.equal(controlledGateAllowsSkip("retitle", outcome), false);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      const env = key === "hard" ? "LLM_HARD_GATE_ENABLED" : key === "approved" ? "JEV_GATE_EVAL_APPROVED" : key === "tasks" ? "AI_HARD_GATE_TASKS" : "JEV_GATE_MIN_CONFIDENCE";
      if (value === undefined) delete process.env[env]; else process.env[env] = value;
    }
  }
});

test("shadow backfill fingerprints are stable and retries are bounded", () => {
  const input = { contentHash: "content", taxonomyVersion: "1", provider: "jev", model: "jev-latest", questionIds: ["topic", "jurisdiction"] };
  assert.equal(decisionFingerprint(input), decisionFingerprint({ ...input, questionIds: [...input.questionIds].reverse() }));
  assert.deepEqual(decisionRetryState([]), { status: "READY" });
  assert.deepEqual(decisionRetryState([{ ok: true, createdAt: new Date(0) }]), { status: "COMPLETE" });
  assert.equal(decisionRetryState([{ ok: false, createdAt: new Date(10_000) }], new Date(20_000), { baseDelayMs: 60_000 }).status, "WAIT");
  assert.deepEqual(decisionRetryState(Array.from({ length: 3 }, (_, index) => ({ ok: false, createdAt: new Date(index) }))), { status: "EXHAUSTED" });
});

test("shadow comparison reports agreement and deterministic unknown resolution", () => {
  assert.deepEqual(summarizeShadowComparisons([
    { ok: true, baselineValue: '{"jurisdiction":"UNKNOWN","contentType":"NEWS"}', selectedValue: '{"jurisdiction":"us","contentType":"NEWS"}' },
    { ok: false, baselineValue: null, selectedValue: null },
  ]), {
    calls: 2,
    successful: 1,
    failed: 1,
    comparableDecisions: 2,
    agreements: 1,
    disagreements: 1,
    resolvedFromUnknown: 1,
  });
});

test("labeled eval separates false negatives from false positives and known misclassification", () => {
  const calls = [{
    id: "call-1", ok: true, inputTokens: 20, outputTokens: 4, baselineValue: null,
    selectedValue: '{"jurisdiction":"UNKNOWN","contentType":"NEWS","primaryTopic":"inflation"}',
  }];
  const result = evaluateShadowLabels(calls, [{
    decisionCallId: "call-1",
    expected: { jurisdiction: "us", contentType: "UNKNOWN", primaryTopic: ["employment", "economic-growth"] },
  }]);
  assert.equal(result.falseNegative, 1);
  assert.equal(result.falsePositive, 1);
  assert.equal(result.wrongKnown, 1);
  assert.equal(result.knownRecall, 0);
  assert.equal(result.totalInputTokens, 20);
  assert.equal(result.labelCoverage, 1);

  const stable = evaluateShadowLabels([{ ...calls[0], id: "different-id", requestFingerprint: "stable-fingerprint" }], [{
    requestFingerprint: "stable-fingerprint",
    expected: { jurisdiction: "us" },
  }]);
  assert.equal(stable.labeledCalls, 1);
  assert.equal(stable.falseNegative, 1);
});
