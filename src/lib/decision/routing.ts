import { JevDecisionProvider } from "./jev";
import { runShadowDecision, type ShadowDecisionOutcome } from "./shadow";
import type { DecisionRequest } from "./types";
import type { AiExecutionPolicy } from "../llm/execution-policy";
import type { LlmTask } from "../llm/types";

export interface RoutingDecisionInput {
  task: LlmTask;
  contentId?: string;
  title?: string;
  excerpt?: string;
  structuredMetadata?: Record<string, unknown>;
  policy: AiExecutionPolicy;
}

const hardGateTasks = () => new Set((process.env.AI_HARD_GATE_TASKS ?? "retitle").split(",").map((value) => value.trim()).filter(Boolean));

export function buildRoutingShadowRequest(input: RoutingDecisionInput): DecisionRequest {
  return {
    decisionType: "ai.execution.shadow",
    state: {
      task: input.task,
      title: input.title,
      excerpt: input.excerpt,
      structuredMetadata: input.structuredMetadata ?? {},
      deterministicPolicy: {
        executionLevel: input.policy.executionLevel,
        requiresLLM: input.policy.requiresLLM,
        contextStrategy: input.policy.contextStrategy,
        reasonCodes: input.policy.reasonCodes,
      },
    },
    questions: {
      executionLevel: {
        type: "choice",
        instructions: "Recommend the minimum safe execution level. SKIP only when the content adds no material information for this task; preserve DEEP when evidence is uncertain.",
        criteria: {
          SKIP: "No model generation is needed.",
          LIGHT: "Use selective context and ordinary generation.",
          DEEP: "Use expanded or full context and deep reasoning.",
        },
      },
      containsNewInformation: { type: "noul", instructions: "How likely is the content to contain material new information for this task?" },
      requiresHumanReview: { type: "noul", instructions: "How likely is the result to require human review?" },
    },
    audit: {
      contentId: input.contentId,
      requestFingerprint: input.policy.fingerprint,
      baselineValue: JSON.stringify({ executionLevel: input.policy.executionLevel }),
      shadowMode: true,
    },
  };
}

/** Advisory only unless a separately approved hard gate is enabled later. */
export async function runRoutingShadow(input: RoutingDecisionInput): Promise<ShadowDecisionOutcome> {
  if (process.env.AI_PREFLIGHT_ENABLED?.trim().toLowerCase() !== "true") {
    return { status: "DISABLED", reason: "JEV_DECISION_DISABLED" };
  }
  const provider = new JevDecisionProvider();
  const request = buildRoutingShadowRequest(input);
  const gateApproved = process.env.LLM_HARD_GATE_ENABLED?.trim().toLowerCase() === "true"
    && process.env.JEV_GATE_EVAL_APPROVED?.trim().toLowerCase() === "true"
    && hardGateTasks().has(input.task);
  if (!gateApproved) return runShadowDecision(provider, request);
  // A controlled gate is still fail-open, but records that this was an active decision
  // rather than pretending a production skip was merely a shadow comparison.
  try {
    const result = await provider.evaluate({ ...request, audit: { ...request.audit, shadowMode: false } });
    return { status: "RECORDED", result };
  } catch (error) {
    return { status: "FAILED", error: String(error).slice(0, 500) };
  }
}

export function controlledGateAllowsSkip(task: LlmTask, outcome: ShadowDecisionOutcome): boolean {
  if (process.env.LLM_HARD_GATE_ENABLED?.trim().toLowerCase() !== "true") return false;
  if (process.env.JEV_GATE_EVAL_APPROVED?.trim().toLowerCase() !== "true") return false;
  if (!hardGateTasks().has(task) || outcome.status !== "RECORDED") return false;
  const answer = outcome.result.answers.executionLevel;
  const threshold = Math.max(0, Math.min(1, Number(process.env.JEV_GATE_MIN_CONFIDENCE ?? 0.95)));
  return answer?.type === "choice" && answer.choice === "SKIP" && answer.confidence >= threshold;
}
