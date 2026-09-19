import { createHash } from "node:crypto";
import type { DecisionRequest } from "./types";

export interface ConsistencyReviewInput {
  contentId: string;
  source: { title: string; text: string; contentHash: string };
  generated: {
    summary?: string | null;
    keyArguments?: unknown;
    keyNumbers?: unknown;
    interpretation?: string | null;
    atomicViews?: Array<{ view: string; sourceQuote: string; direction?: string | null }>;
  };
}

export function consistencyFingerprint(input: ConsistencyReviewInput): string {
  return createHash("sha256").update(JSON.stringify({
    contentHash: input.source.contentHash,
    generated: input.generated,
    version: "source-consistency-v1",
  })).digest("hex");
}

/** Checks source support only. It deliberately does not claim to verify real-world truth. */
export function buildSourceConsistencyRequest(input: ConsistencyReviewInput): DecisionRequest {
  return {
    decisionType: "analysis.source-consistency.shadow",
    state: {
      source: { title: input.source.title, text: input.source.text },
      generated: input.generated,
      scope: "Compare generated claims only with the supplied source. Do not use outside knowledge.",
    },
    questions: {
      sourceContradiction: { type: "noul", instructions: "How likely is any generated claim contradicted by the supplied source?" },
      unsupportedClaim: { type: "noul", instructions: "How likely is any material generated claim unsupported by the supplied source?" },
      unsupportedNumber: { type: "noul", instructions: "How likely is any generated number absent from or inconsistent with the supplied source?" },
      policyDirectionMismatch: { type: "noul", instructions: "How likely is a stated policy direction inconsistent with the supplied source? Use low likelihood when policy direction is not applicable." },
      missingMaterialCaveat: { type: "noul", instructions: "How likely has the generated output omitted a source caveat that materially changes the conclusion?" },
      requiresReview: { type: "noul", instructions: "How likely should a human review this generated output for source consistency?" },
    },
    audit: { contentId: input.contentId, requestFingerprint: consistencyFingerprint(input), shadowMode: true },
  };
}
