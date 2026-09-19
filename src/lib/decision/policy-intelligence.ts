import { createHash } from "node:crypto";
import type { ParsedPolicyDocument } from "../macro/policy/types";
import type { DecisionRequest } from "./types";

export interface PolicyIntelligenceInput {
  contentId: string;
  centralBank: string;
  current: { id: string; contentHash: string; publishedAt: string; parsed: ParsedPolicyDocument };
  previous?: { id: string; contentHash: string; publishedAt: string; parsed: ParsedPolicyDocument } | null;
}

export function policyIntelligenceFingerprint(input: PolicyIntelligenceInput): string {
  return createHash("sha256").update(JSON.stringify({
    centralBank: input.centralBank,
    current: input.current.contentHash,
    previous: input.previous?.contentHash ?? null,
    version: "policy-intelligence-v1",
  })).digest("hex");
}

/** Source-agnostic policy classification; fixed rates/votes remain deterministic fields. */
export function buildPolicyIntelligenceRequest(input: PolicyIntelligenceInput): DecisionRequest {
  const hasPrevious = Boolean(input.previous);
  return {
    decisionType: "policy.intelligence.shadow",
    state: {
      centralBank: input.centralBank,
      current: input.current,
      previous: input.previous ?? null,
      comparisonAvailable: hasPrevious,
    },
    questions: {
      policyBias: {
        type: "choice",
        instructions: "Classify the current policy bias from the supplied structured document. Preserve UNKNOWN when evidence is insufficient.",
        criteria: { HAWKISH: "Hawkish", DOVISH: "Dovish", NEUTRAL: "Neutral", MIXED: "Mixed", UNKNOWN: null },
      },
      inflationConcern: { type: "noul", instructions: "How strongly does the current document express inflation concern?" },
      employmentConcern: { type: "noul", instructions: "How strongly does the current document express employment or labor-market concern?" },
      growthConcern: { type: "noul", instructions: "How strongly does the current document express growth concern?" },
      policyChanged: { type: "noul", instructions: hasPrevious ? "How likely is policy materially changed versus the supplied previous document?" : "Return low likelihood because no previous document is supplied." },
      becameMoreHawkish: { type: "noul", instructions: hasPrevious ? "How likely did the stance become materially more hawkish?" : "Return low likelihood because no previous document is supplied." },
      becameMoreDovish: { type: "noul", instructions: hasPrevious ? "How likely did the stance become materially more dovish?" : "Return low likelihood because no previous document is supplied." },
      inflationConcernIncreased: { type: "noul", instructions: hasPrevious ? "How likely did inflation concern materially increase?" : "Return low likelihood because no previous document is supplied." },
      growthConcernIncreased: { type: "noul", instructions: hasPrevious ? "How likely did growth concern materially increase?" : "Return low likelihood because no previous document is supplied." },
      forwardGuidanceChanged: { type: "noul", instructions: hasPrevious ? "How likely did forward guidance materially change?" : "Return low likelihood because no previous document is supplied." },
      balanceSheetChanged: { type: "noul", instructions: hasPrevious ? "How likely did balance-sheet policy materially change?" : "Return low likelihood because no previous document is supplied." },
      requiresReview: { type: "noul", instructions: "How likely does this policy classification require human review?" },
    },
    audit: { contentId: input.contentId, requestFingerprint: policyIntelligenceFingerprint(input), shadowMode: true },
  };
}
