import evalLabels from "../../../data/classification/jev-eval-labels-v1.json";
import { prisma } from "@/lib/db";
import { evaluateShadowLabels, summarizeShadowComparisons, type DecisionEvalLabel } from "./backfill";

const DECISION_TYPE = "content.classification.shadow";

export async function classificationDecisionReport(days = 30) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const allCalls = await prisma.decisionCall.findMany({
    where: { provider: "jev", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 5_000,
  });
  const calls = allCalls.filter((call) => call.decisionType === DECISION_TYPE);

  const successful = calls.filter((call) => call.ok);
  const comparisons = summarizeShadowComparisons(calls);
  const evaluation = evaluateShadowLabels(calls, evalLabels as DecisionEvalLabel[]);
  const sum = (pick: (call: (typeof calls)[number]) => number) => calls.reduce((total, call) => total + pick(call), 0);
  const confidenceCalls = successful.filter((call) => call.confidence !== null);

  return {
    days,
    enabled: process.env.JEV_DECISION_ENABLED?.trim().toLowerCase() === "true",
    shadowMode: process.env.JEV_SHADOW_MODE?.trim().toLowerCase() !== "false",
    all: {
      calls: allCalls.length,
      successful: allCalls.filter((call) => call.ok).length,
      inputTokens: allCalls.reduce((total, call) => total + call.inputTokens, 0),
      outputTokens: allCalls.reduce((total, call) => total + call.outputTokens, 0),
      byType: [...new Map(allCalls.map((call) => [call.decisionType, 0])).keys()].map((decisionType) => ({
        label: decisionType,
        value: allCalls.filter((call) => call.decisionType === decisionType).length,
      })).sort((a, b) => b.value - a.value),
    },
    totals: {
      calls: calls.length,
      successful: successful.length,
      failed: calls.length - successful.length,
      successRate: calls.length ? successful.length / calls.length : null,
      inputTokens: sum((call) => call.inputTokens),
      outputTokens: sum((call) => call.outputTokens),
      averageDurationMs: calls.length ? sum((call) => call.durationMs) / calls.length : null,
      averageConfidence: confidenceCalls.length
        ? confidenceCalls.reduce((total, call) => total + (call.confidence ?? 0), 0) / confidenceCalls.length
        : null,
      uniqueRequests: new Set(calls.map((call) => call.requestFingerprint).filter(Boolean)).size,
    },
    comparisons,
    evaluation,
    recent: calls.slice(0, 8),
  };
}
