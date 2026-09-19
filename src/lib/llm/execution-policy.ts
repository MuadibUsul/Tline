import { createHash } from "node:crypto";
import { dayKey } from "../analytics/identity";
import type { LlmTask } from "./types";

export type ExecutionLevel = "LEVEL_0" | "LEVEL_1" | "LEVEL_2" | "LEVEL_3";
export type ContextStrategy = "STRUCTURED" | "SELECTIVE" | "EXPANDED" | "FULL";
export type AiExecutionTask = LlmTask | "classification" | "source_consistency" | "policy_intelligence" | "view_change";
export type ReasonCode =
  | "STRUCTURED_DATA_SUFFICIENT"
  | "EXISTING_RESULT_REUSABLE"
  | "DUPLICATE_CONTENT"
  | "DECISION_ONLY"
  | "REQUIRES_LANGUAGE_GENERATION"
  | "REQUIRES_SEMANTIC_EXTRACTION"
  | "REQUIRES_DEEP_REASONING"
  | "LOW_CONFIDENCE_ESCALATION"
  | "WITHIN_CONTEXT_BUDGET"
  | "FULL_CONTEXT_REQUIRED";

export interface AiExecutionPolicyInput {
  taskType: LlmTask;
  contentId?: string;
  contentHash: string;
  structuredMetadata?: Record<string, unknown>;
  existingArtifacts?: { reusable: boolean };
  duplicate?: boolean;
  requestedOutput?: "classification" | "translation" | "analysis" | "forecast" | "policy" | "retitle" | "review";
  sourceInfo?: { requiresFullText?: boolean };
  promptVersion: string;
  contextBuilderVersion: string;
  route?: { provider?: string; model?: string };
}

export interface AiExecutionPolicy {
  executionLevel: ExecutionLevel;
  requiresLLM: boolean;
  requiresDecision: boolean;
  requiresFullText: boolean;
  reusableArtifact: boolean;
  contextStrategy: ContextStrategy;
  reasonCodes: ReasonCode[];
  fingerprint: string;
}

const stable = (value: unknown): unknown => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
    : value;

export function aiExecutionFingerprint(input: AiExecutionPolicyInput): string {
  return createHash("sha256").update(JSON.stringify(stable({
    contentHash: input.contentHash,
    taskType: input.taskType,
    promptVersion: input.promptVersion,
    contextBuilderVersion: input.contextBuilderVersion,
    route: input.route ?? {},
  }))).digest("hex");
}

export function decideAiExecution(input: AiExecutionPolicyInput): AiExecutionPolicy {
  const fingerprint = aiExecutionFingerprint(input);
  if (input.existingArtifacts?.reusable) return {
    executionLevel: "LEVEL_0", requiresLLM: false, requiresDecision: false, requiresFullText: false,
    reusableArtifact: true, contextStrategy: "STRUCTURED", reasonCodes: ["EXISTING_RESULT_REUSABLE"], fingerprint,
  };
  if (input.duplicate) return {
    executionLevel: "LEVEL_0", requiresLLM: false, requiresDecision: false, requiresFullText: false,
    reusableArtifact: false, contextStrategy: "STRUCTURED", reasonCodes: ["DUPLICATE_CONTENT"], fingerprint,
  };
  if (input.requestedOutput === "classification" && Object.keys(input.structuredMetadata ?? {}).length) return {
    executionLevel: "LEVEL_0", requiresLLM: false, requiresDecision: false, requiresFullText: false,
    reusableArtifact: false, contextStrategy: "STRUCTURED", reasonCodes: ["STRUCTURED_DATA_SUFFICIENT"], fingerprint,
  };

  const full = input.sourceInfo?.requiresFullText === true || input.taskType === "translation" || input.taskType === "translation_review" || input.taskType === "policy";
  const language = input.taskType === "translation" || input.taskType === "translation_review" || input.taskType === "retitle";
  const deep = input.taskType === "analysis" || input.taskType === "release_analysis" || input.taskType === "policy" || input.requestedOutput === "analysis";
  const reasonCodes: ReasonCode[] = [deep ? "REQUIRES_DEEP_REASONING" : language ? "REQUIRES_LANGUAGE_GENERATION" : "REQUIRES_SEMANTIC_EXTRACTION"];
  if (full) reasonCodes.push("FULL_CONTEXT_REQUIRED");
  return {
    executionLevel: deep ? "LEVEL_3" : "LEVEL_2",
    requiresLLM: true,
    requiresDecision: process.env.JEV_DECISION_ENABLED?.trim().toLowerCase() === "true",
    requiresFullText: full,
    reusableArtifact: false,
    contextStrategy: full ? "FULL" : input.taskType === "release_analysis" ? "STRUCTURED" : "SELECTIVE",
    reasonCodes,
    fingerprint,
  };
}

export interface AiExecutionEventInput {
  task: AiExecutionTask;
  contentId?: string;
  policy: AiExecutionPolicy;
  cacheStatus: "HIT" | "MISS" | "NOT_APPLICABLE";
  attribution?: "DETERMINISTIC" | "CACHE" | "JEV_GATE" | "CONTEXT_REDUCTION" | "ARTIFACT_REUSE" | "DUPLICATE_SKIP";
  originalEstimatedTokens?: number;
  optimizedEstimatedTokens?: number;
  actualInputTokens?: number;
}

let warned = false;
export async function recordAiExecutionEvent(input: AiExecutionEventInput): Promise<void> {
  try {
    const { prisma } = await import("../db");
    await prisma.aiExecutionEvent.create({ data: {
      day: dayKey(), task: input.task, contentId: input.contentId ?? null,
      requestFingerprint: input.policy.fingerprint, executionLevel: input.policy.executionLevel,
      requiresLLM: input.policy.requiresLLM, requiresDecision: input.policy.requiresDecision,
      contextStrategy: input.policy.contextStrategy, cacheStatus: input.cacheStatus,
      reasonCodes: JSON.stringify(input.policy.reasonCodes), savingsAttribution: input.attribution ?? null,
      originalEstimatedTokens: input.originalEstimatedTokens ?? 0,
      optimizedEstimatedTokens: input.optimizedEstimatedTokens ?? 0,
      actualInputTokens: input.actualInputTokens ?? null,
    } });
  } catch (error) {
    if (!warned) {
      warned = true;
      console.error(JSON.stringify({ event: "ai.execution.record.failed", error: String(error).slice(0, 300) }));
    }
  }
}

export async function hasCompletedAiExecution(fingerprint: string): Promise<boolean> {
  try {
    const { prisma } = await import("../db");
    return Boolean(await prisma.aiExecutionEvent.findFirst({
      where: { requestFingerprint: fingerprint },
      select: { id: true },
    }));
  } catch {
    // Fail open: observability/cache lookup must never halt the original pipeline.
    return false;
  }
}

export async function hasRecordedAiExecution(fingerprint: string, cacheStatus?: "HIT" | "MISS" | "NOT_APPLICABLE"): Promise<boolean> {
  try {
    const { prisma } = await import("../db");
    return Boolean(await prisma.aiExecutionEvent.findFirst({
      where: { requestFingerprint: fingerprint, ...(cacheStatus ? { cacheStatus } : {}) },
      select: { id: true },
    }));
  } catch {
    return false;
  }
}

export async function recordDeterministicResolution(input: { task: AiExecutionTask; contentId?: string; fingerprint: string }): Promise<void> {
  if (await hasRecordedAiExecution(input.fingerprint, "NOT_APPLICABLE")) return;
  await recordAiExecutionEvent({
    task: input.task,
    contentId: input.contentId,
    policy: {
      executionLevel: "LEVEL_0", requiresLLM: false, requiresDecision: false, requiresFullText: false,
      reusableArtifact: false, contextStrategy: "STRUCTURED", reasonCodes: ["STRUCTURED_DATA_SUFFICIENT"], fingerprint: input.fingerprint,
    },
    cacheStatus: "NOT_APPLICABLE",
    attribution: "DETERMINISTIC",
  });
}
