import { dayKey } from "../analytics/identity";

export interface DecisionCallRecord {
  provider: string;
  model: string;
  decisionType: string;
  contentId?: string;
  classificationId?: string;
  requestFingerprint?: string;
  inputBytes: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  ok: boolean;
  confidence?: number;
  selectedValue?: string;
  baselineValue?: string;
  shadowMode: boolean;
  error?: string;
}

let warned = false;

/** Decision telemetry must never turn a successful provider call into a failed pipeline. */
export async function recordDecisionCall(record: DecisionCallRecord): Promise<void> {
  try {
    const { prisma } = await import("../db");
    await prisma.decisionCall.create({
      data: {
        day: dayKey(),
        provider: record.provider,
        model: record.model,
        decisionType: record.decisionType,
        contentId: record.contentId ?? null,
        classificationId: record.classificationId ?? null,
        requestFingerprint: record.requestFingerprint ?? null,
        inputBytes: record.inputBytes,
        inputTokens: record.inputTokens ?? 0,
        outputTokens: record.outputTokens ?? 0,
        durationMs: record.durationMs,
        ok: record.ok,
        confidence: record.confidence ?? null,
        selectedValue: record.selectedValue?.slice(0, 500) ?? null,
        baselineValue: record.baselineValue?.slice(0, 500) ?? null,
        shadowMode: record.shadowMode,
        error: record.error?.slice(0, 500) ?? null,
      },
    });
  } catch (error) {
    if (!warned) {
      warned = true;
      console.error(JSON.stringify({ event: "decision.usage.record.failed", error: String(error).slice(0, 300) }));
    }
  }
}
