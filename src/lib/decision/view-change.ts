import { createHash } from "node:crypto";
import type { DecisionRequest } from "./types";

export interface ComparableAtomicView {
  id: string;
  articleId: string;
  publishedAt: string;
  view: string;
  direction: string;
  type: string;
  value?: string | null;
  timeHorizon: string;
  sourceQuote: string;
}

export interface ViewChangeInput {
  contentId: string;
  institutionId: string;
  jurisdiction: string;
  topic: string;
  previous: ComparableAtomicView;
  current: ComparableAtomicView;
}

export function viewChangeFingerprint(input: ViewChangeInput): string {
  return createHash("sha256").update(JSON.stringify({
    institutionId: input.institutionId, jurisdiction: input.jurisdiction, topic: input.topic,
    previousId: input.previous.id, currentId: input.current.id, version: "view-change-v1",
  })).digest("hex");
}

/** Both sides are required database records, so the decision layer cannot invent an old view. */
export function buildViewChangeRequest(input: ViewChangeInput): DecisionRequest {
  if (input.previous.id === input.current.id || input.previous.articleId === input.current.articleId) {
    throw new Error("View change requires distinct historical and current records.");
  }
  return {
    decisionType: "atomic-view.change.shadow",
    state: {
      institutionId: input.institutionId,
      jurisdiction: input.jurisdiction,
      topic: input.topic,
      previous: input.previous,
      current: input.current,
    },
    questions: {
      viewChanged: { type: "noul", instructions: "How likely did the institution's substantive view change?" },
      directionChanged: { type: "noul", instructions: "How likely did the directional stance change?" },
      forecastChanged: { type: "noul", instructions: "How likely did a forecast, target, horizon or condition materially change?" },
      materialChange: { type: "noul", instructions: "How likely is the change material enough to surface to a reader?" },
      requiresReview: { type: "noul", instructions: "How likely does this comparison require human review?" },
    },
    audit: { contentId: input.contentId, requestFingerprint: viewChangeFingerprint(input), shadowMode: true },
  };
}
