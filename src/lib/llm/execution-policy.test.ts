import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskContext, estimateTokens } from "./context-builder";
import { aiExecutionFingerprint, decideAiExecution, type AiExecutionPolicyInput } from "./execution-policy";

const input: AiExecutionPolicyInput = { taskType: "analysis", contentHash: "abc", promptVersion: "analysis-v2", contextBuilderVersion: "context-v1" };

test("execution policy reuses a valid business artifact before selecting a provider", () => {
  const policy = decideAiExecution({ ...input, existingArtifacts: { reusable: true } });
  assert.equal(policy.executionLevel, "LEVEL_0");
  assert.equal(policy.requiresLLM, false);
  assert.deepEqual(policy.reasonCodes, ["EXISTING_RESULT_REUSABLE"]);
});

test("execution fingerprints are stable across metadata key order", () => {
  assert.equal(aiExecutionFingerprint({ ...input, structuredMetadata: { a: 1, b: 2 } }), aiExecutionFingerprint({ ...input, structuredMetadata: { b: 2, a: 1 } }));
});

test("context builder keeps conclusion sections instead of taking only the prefix", () => {
  const opening = "opening ".repeat(120);
  const noise = "noise ".repeat(300);
  const conclusion = "material caveat ".repeat(120);
  const built = buildTaskContext("analysis", {
    title: "Outlook",
    text: `${opening}\n\n${noise}\n\n${conclusion}`,
    sections: [
      { heading: "Introduction", text: opening },
      { heading: "Appendix", text: noise },
      { heading: "Conclusion", text: conclusion },
    ],
  });
  assert.match(built.selectedText, /material caveat/);
  assert.ok(built.selectedSections.includes("Conclusion"));
  assert.ok(estimateTokens(built.selectedText) <= built.originalEstimatedTokens || built.originalEstimatedTokens < 10);
});

test("execution level is independent from full-text requirements", () => {
  const base = { contentHash: "hash", promptVersion: "v1", contextBuilderVersion: "v1" };
  const translation = decideAiExecution({ ...base, taskType: "translation", requestedOutput: "translation" });
  assert.equal(translation.executionLevel, "LEVEL_2");
  assert.equal(translation.requiresFullText, true);
  assert.ok(translation.reasonCodes.includes("FULL_CONTEXT_REQUIRED"));
  const analysis = decideAiExecution({ ...base, taskType: "analysis", requestedOutput: "analysis" });
  assert.equal(analysis.executionLevel, "LEVEL_3");
});

test("decision context respects a hard budget with whole sentences instead of prefix truncation", () => {
  const middle = Array.from({ length: 80 }, (_, index) => `Paragraph ${index}. Supporting detail ${index}.`).join("\n\n");
  const built = buildTaskContext("classification", {
    title: "Global inflation outlook",
    text: `Introduction. Scope is global.\n\n${middle}\n\nConclusion. Inflation is expected to slow.`,
  }, { preferredInputTokens: 60, maxInputTokens: 60, fullTextAllowed: false });
  assert.ok(built.estimatedTokens <= 60);
  assert.match(built.selectedText, /Global inflation outlook/);
  assert.doesNotMatch(built.selectedText, /Supporting det$/);
});
