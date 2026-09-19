import type { DecisionRequest } from "./types";

export interface SemanticRelevanceInput {
  contentId: string;
  watch: { jurisdictions?: string[]; topics?: string[]; institutions?: string[]; assets?: string[] };
  candidate: { title: string; excerpt: string; structuredFacets?: Record<string, unknown> };
  requestFingerprint: string;
}

/** Interface-only reservation for watchlist semantics; it is not wired into alerts. */
export function buildSemanticRelevanceRequest(input: SemanticRelevanceInput): DecisionRequest {
  return {
    decisionType: "watchlist.semantic-relevance.shadow",
    state: { watch: input.watch, candidate: input.candidate },
    questions: {
      materiallyRelevant: { type: "noul", instructions: "How likely is the candidate materially relevant to the watch, rather than a passing mention?" },
      requiresReview: { type: "noul", instructions: "How likely should a person review this match before an alert is sent?" },
    },
    audit: { contentId: input.contentId, requestFingerprint: input.requestFingerprint, shadowMode: true },
  };
}
