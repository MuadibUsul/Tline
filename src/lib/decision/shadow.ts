import type { DecisionProvider, DecisionRequest, DecisionResponse } from "./types";

export type ShadowDecisionOutcome =
  | { status: "DISABLED"; reason: "JEV_DECISION_DISABLED" | "SHADOW_MODE_REQUIRED" }
  | { status: "RECORDED"; result: DecisionResponse }
  | { status: "FAILED"; error: string };

const enabledFromEnv = () => process.env.JEV_DECISION_ENABLED?.trim().toLowerCase() === "true";
const shadowFromEnv = () => process.env.JEV_SHADOW_MODE?.trim().toLowerCase() !== "false";

/** Fail-open shadow execution: its outcome is observable but can never block the caller. */
export async function runShadowDecision(
  provider: DecisionProvider,
  request: DecisionRequest,
  flags: { enabled?: boolean; shadowMode?: boolean } = {},
): Promise<ShadowDecisionOutcome> {
  if (!(flags.enabled ?? enabledFromEnv())) return { status: "DISABLED", reason: "JEV_DECISION_DISABLED" };
  if (!(flags.shadowMode ?? shadowFromEnv())) return { status: "DISABLED", reason: "SHADOW_MODE_REQUIRED" };
  try {
    const result = await provider.evaluate({ ...request, audit: { ...request.audit, shadowMode: true } });
    return { status: "RECORDED", result };
  } catch (error) {
    return { status: "FAILED", error: String(error).slice(0, 500) };
  }
}
