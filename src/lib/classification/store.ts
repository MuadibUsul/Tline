import { createHash } from "node:crypto";
import { prisma } from "../db";
import { DETERMINISTIC_CLASSIFIER_VERSION } from "./classifier";
import { taxonomy } from "./taxonomy";
import type { ClassificationResult, ClassifiableContentKind } from "./types";
import { recordDeterministicResolution } from "../llm/execution-policy";

export type ClassificationTarget =
  | { kind: "ARTICLE"; id: string }
  | { kind: "MACRO_INDICATOR"; id: string }
  | { kind: "MACRO_RELEASE"; id: string }
  | { kind: "POLICY_DOCUMENT"; id: string };

export function classificationFingerprint(target: ClassificationTarget, sourceFingerprint: string): string {
  return createHash("sha256").update(JSON.stringify({
    kind: target.kind, id: target.id, sourceFingerprint,
    taxonomyVersion: taxonomy.version, classifierVersion: DETERMINISTIC_CLASSIFIER_VERSION,
  })).digest("hex");
}

export function articleClassificationSourceFingerprint(contentHash: string, titleHash: string, assetTickers: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify({ contentHash, titleHash, assetTickers: [...assetTickers].sort() })).digest("hex");
}

const targetData = (target: ClassificationTarget) => ({
  contentKind: target.kind as ClassifiableContentKind,
  ...(target.kind === "ARTICLE" ? { articleId: target.id } : {}),
  ...(target.kind === "MACRO_INDICATOR" ? { macroIndicatorId: target.id } : {}),
  ...(target.kind === "MACRO_RELEASE" ? { macroReleaseId: target.id } : {}),
  ...(target.kind === "POLICY_DOCUMENT" ? { policyDocumentId: target.id } : {}),
});

const targetWhere = (target: ClassificationTarget) => target.kind === "ARTICLE" ? { articleId: target.id }
  : target.kind === "MACRO_INDICATOR" ? { macroIndicatorId: target.id }
    : target.kind === "MACRO_RELEASE" ? { macroReleaseId: target.id }
      : { policyDocumentId: target.id };

/** Idempotent deterministic persistence. A human-owned result is never overwritten. */
export async function persistDeterministicClassification(input: {
  target: ClassificationTarget;
  result: ClassificationResult;
  sourceFingerprint: string;
  apply: boolean;
}): Promise<"planned" | "created" | "updated" | "reused" | "manual"> {
  const fingerprint = classificationFingerprint(input.target, input.sourceFingerprint);
  const existing = await prisma.contentClassification.findFirst({ where: targetWhere(input.target), select: { id: true, source: true, fingerprint: true } });
  if (existing?.source === "MANUAL") return "manual";
  if (existing?.fingerprint === fingerprint) {
    if (input.apply) await recordDeterministicResolution({ task: "classification", contentId: input.target.id, fingerprint });
    return "reused";
  }
  if (!input.apply) return "planned";
  const assets = input.result.assets.length
    ? await prisma.asset.findMany({ where: { ticker: { in: input.result.assets.map((item) => item.key) } }, select: { id: true, ticker: true } })
    : [];
  const assetIds = new Map(assets.map((asset) => [asset.ticker, asset.id]));
  const facets = {
    jurisdictions: { create: [
      ...(input.result.primaryJurisdiction ? [{ jurisdictionKey: input.result.primaryJurisdiction, role: "PRIMARY" }] : []),
      ...input.result.relatedJurisdictions.map((jurisdictionKey) => ({ jurisdictionKey, role: "RELATED" })),
    ] },
    institutions: { create: input.result.institutions.map((item) => ({ institutionKey: item.key, role: item.role, confidence: item.confidence })) },
    topics: { create: input.result.topics.map((item) => ({ topicKey: item.key, confidence: item.confidence })) },
    assets: { create: input.result.assets.flatMap((item) => assetIds.has(item.key) ? [{ assetId: assetIds.get(item.key)!, confidence: item.confidence }] : []) },
    assetClasses: { create: input.result.assetClasses.map((item) => ({ assetClassKey: item.key, confidence: item.confidence })) },
    events: { create: input.result.events.map((item) => ({ eventKey: item.key, confidence: item.confidence })) },
  };
  const scalars = {
    jurisdictionState: input.result.jurisdictionState, contentType: input.result.contentType,
    confidence: input.result.confidence, source: "DETERMINISTIC",
    status: input.result.jurisdictionState === "UNKNOWN" || input.result.contentType === "UNKNOWN"
      ? "PENDING" : input.result.confidence >= 1 ? "CLASSIFIED" : "REVIEW",
    classifier: "deterministic", classifierVersion: DETERMINISTIC_CLASSIFIER_VERSION,
    taxonomyVersion: taxonomy.version, fingerprint, classifiedAt: new Date(),
  };
  if (!existing) {
    await prisma.contentClassification.create({ data: { ...targetData(input.target), ...scalars, ...facets } });
    await recordDeterministicResolution({ task: "classification", contentId: input.target.id, fingerprint });
    return "created";
  }
  await prisma.contentClassification.update({
    where: { id: existing.id },
    data: {
      ...scalars,
      jurisdictions: { deleteMany: {}, ...facets.jurisdictions },
      institutions: { deleteMany: {}, ...facets.institutions },
      topics: { deleteMany: {}, ...facets.topics },
      assets: { deleteMany: {}, ...facets.assets },
      assetClasses: { deleteMany: {}, ...facets.assetClasses },
      events: { deleteMany: {}, ...facets.events },
    },
  });
  await recordDeterministicResolution({ task: "classification", contentId: input.target.id, fingerprint });
  return "updated";
}
