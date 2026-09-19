import { taxonomy } from "../classification/taxonomy";
import type { ClassificationResult } from "../classification/types";
import type { ChoiceQuestion, DecisionRequest, DecisionResponse } from "./types";

export interface ClassificationShadowInput {
  /** Text must already be extracted; this layer never downloads or parses a PDF. */
  document: { title?: string; excerpt: string };
  deterministic: ClassificationResult;
  classificationId?: string;
  requestFingerprint?: string;
}

function choice(
  instructions: string,
  values: ReadonlyArray<{ key: string; nameEn: string }>,
  includeDecisionStates = false,
): ChoiceQuestion {
  const criteria = Object.fromEntries(values.map((value) => [value.key, value.nameEn])) as Record<string, string | null>;
  if (includeDecisionStates) {
    criteria.GLOBAL = "The content is global rather than tied to one jurisdiction.";
    criteria.MULTIPLE = "Multiple jurisdictions are equally primary.";
    criteria.UNKNOWN = null;
    criteria.NONE = "The content explicitly has no jurisdiction.";
    criteria.NOT_APPLICABLE = "Jurisdiction does not apply to this content.";
  } else if (!("UNKNOWN" in criteria)) {
    criteria.UNKNOWN = null;
  }
  return { type: "choice", instructions, criteria };
}

/**
 * Builds a shadow-only request for deterministic gaps. It never replaces a manual
 * classification and does not invent confidence thresholds for already-known values.
 */
export function buildClassificationShadowRequest(input: ClassificationShadowInput): DecisionRequest | null {
  const baseline = input.deterministic;
  if (baseline.source === "MANUAL") return null;

  const questions: Record<string, ChoiceQuestion> = {};
  if (baseline.jurisdictionState === "UNKNOWN") {
    questions.jurisdiction = choice(
      "Choose the primary jurisdictional scope. Preserve UNKNOWN when evidence is insufficient.",
      taxonomy.jurisdictions,
      true,
    );
  }
  if (baseline.contentType === "UNKNOWN") {
    questions.contentType = choice(
      "Choose the best content type. Preserve UNKNOWN when evidence is insufficient.",
      taxonomy.contentTypes,
    );
  }
  if (baseline.topics.length === 0) {
    questions.primaryTopic = choice(
      "Choose the single most central topic. Preserve UNKNOWN when evidence is insufficient.",
      taxonomy.topics,
    );
  }
  if (Object.keys(questions).length === 0) return null;

  const baselineValue = JSON.stringify(Object.fromEntries(Object.keys(questions).map((question) => [
    question,
    question === "jurisdiction"
      ? baseline.primaryJurisdiction ?? baseline.jurisdictionState
      : question === "contentType"
        ? baseline.contentType
        : baseline.topics[0]?.key ?? "UNKNOWN",
  ])));

  return {
    decisionType: "content.classification.shadow",
    state: {
      document: input.document,
      deterministicBaseline: baseline,
      taxonomyVersion: taxonomy.version,
    },
    questions,
    audit: {
      classificationId: input.classificationId,
      requestFingerprint: input.requestFingerprint,
      baselineValue,
      shadowMode: true,
    },
  };
}

export interface ClassificationDecisionPatch {
  jurisdiction?: { state: ClassificationResult["jurisdictionState"]; primary: ClassificationResult["primaryJurisdiction"]; related: ClassificationResult["relatedJurisdictions"] };
  contentType?: ClassificationResult["contentType"];
  primaryTopic?: ClassificationResult["topics"][number];
  confidence: number;
  status: "CLASSIFIED" | "REVIEW";
  accepted: boolean;
}

/** Converts only questions that the deterministic classifier left unresolved. */
export function classificationDecisionPatch(
  response: DecisionResponse,
  options: { reviewThreshold: number; autoThreshold: number },
): ClassificationDecisionPatch {
  const configuredReview = Number.isFinite(options.reviewThreshold) ? options.reviewThreshold : 0.65;
  const configuredAuto = Number.isFinite(options.autoThreshold) ? options.autoThreshold : 0.9;
  const reviewThreshold = Math.max(0, Math.min(1, configuredReview));
  const autoThreshold = Math.max(reviewThreshold, Math.min(1, configuredAuto));
  const choices = Object.values(response.answers).filter((answer) => answer.type === "choice");
  const confidence = choices.length ? Math.min(...choices.map((answer) => answer.confidence)) : 0;
  const accepted = confidence >= reviewThreshold;
  const patch: ClassificationDecisionPatch = { confidence, status: accepted && confidence >= autoThreshold ? "CLASSIFIED" : "REVIEW", accepted };
  if (!accepted) return patch;

  const jurisdiction = response.answers.jurisdiction;
  if (jurisdiction?.type === "choice") {
    const decisionStates = new Set(["GLOBAL", "MULTIPLE", "UNKNOWN", "NONE", "NOT_APPLICABLE"]);
    if (jurisdiction.choice === "MULTIPLE") {
      // A single choice cannot name the required related jurisdictions. Keep it for review
      // rather than persisting a semantically incomplete MULTIPLE result.
      patch.status = "REVIEW";
    } else if (decisionStates.has(jurisdiction.choice)) {
      patch.jurisdiction = { state: jurisdiction.choice as ClassificationResult["jurisdictionState"], primary: null, related: [] };
      if (jurisdiction.choice === "UNKNOWN") patch.status = "REVIEW";
    } else if (taxonomy.jurisdictions.some((item) => item.key === jurisdiction.choice)) {
      patch.jurisdiction = { state: "KNOWN", primary: jurisdiction.choice as ClassificationResult["primaryJurisdiction"], related: [] };
    }
  }
  const contentType = response.answers.contentType;
  if (contentType?.type === "choice" && taxonomy.contentTypes.some((item) => item.key === contentType.choice)) {
    patch.contentType = contentType.choice as ClassificationResult["contentType"];
  }
  const topic = response.answers.primaryTopic;
  if (topic?.type === "choice" && taxonomy.topics.some((item) => item.key === topic.choice)) {
    patch.primaryTopic = { key: topic.choice as ClassificationResult["topics"][number]["key"], confidence: topic.confidence };
  }
  return patch;
}
