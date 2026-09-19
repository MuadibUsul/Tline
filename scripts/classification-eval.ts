import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { evaluateShadowLabels, type DecisionEvalLabel, type ExpectedDecisionValue } from "../src/lib/decision/backfill";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const limit = Math.min(10_000, Math.max(1, Number(arg("limit") || 1_000)));

function parseObject(value: string | null): Record<string, string | number> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string | number] =>
      typeof entry[1] === "string" || typeof entry[1] === "number"));
  } catch { return {}; }
}

function validateLabels(value: unknown): DecisionEvalLabel[] {
  if (!Array.isArray(value)) throw new Error("Label file must contain a JSON array.");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Label ${index} must be an object.`);
    const row = item as Record<string, unknown>;
    const decisionCallId = typeof row.decisionCallId === "string" && row.decisionCallId ? row.decisionCallId : undefined;
    const requestFingerprint = typeof row.requestFingerprint === "string" && row.requestFingerprint ? row.requestFingerprint : undefined;
    if (!decisionCallId && !requestFingerprint) throw new Error(`Label ${index} requires decisionCallId or requestFingerprint.`);
    if (!row.expected || typeof row.expected !== "object" || Array.isArray(row.expected)) throw new Error(`Label ${index} requires expected.`);
    const expected = Object.fromEntries(Object.entries(row.expected as Record<string, unknown>).map(([key, expectedValue]) => {
      const validScalar = (candidate: unknown): candidate is string | number => typeof candidate === "string" || (typeof candidate === "number" && Number.isFinite(candidate));
      if (!validScalar(expectedValue) && !(Array.isArray(expectedValue) && expectedValue.length > 0 && expectedValue.every(validScalar))) {
        throw new Error(`Label ${index} expected.${key} must be a string, number, or non-empty array.`);
      }
      return [key, expectedValue as ExpectedDecisionValue];
    }));
    return { decisionCallId, requestFingerprint, expected };
  });
}

async function main() {
  if (!Number.isInteger(limit)) throw new Error("--limit must be an integer.");
  const calls = await prisma.decisionCall.findMany({
    where: { provider: "jev", decisionType: "content.classification.shadow", shadowMode: true },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, classificationId: true, requestFingerprint: true, ok: true, model: true, createdAt: true, confidence: true,
      selectedValue: true, baselineValue: true, inputTokens: true, outputTokens: true,
      classification: {
        select: {
          source: true, jurisdictionState: true, contentType: true,
          jurisdictions: true, topics: true,
          article: { select: { id: true, title: true, rawText: true } },
        },
      },
    },
  });

  const manualLabels: DecisionEvalLabel[] = calls.flatMap((call) => {
    const classification = call.classification;
    if (!classification || classification.source !== "MANUAL") return [];
    const selected = parseObject(call.selectedValue);
    const expected: Record<string, ExpectedDecisionValue> = {};
    if ("jurisdiction" in selected) {
      expected.jurisdiction = classification.jurisdictions.find((item) => item.role === "PRIMARY")?.jurisdictionKey ?? classification.jurisdictionState;
    }
    if ("contentType" in selected) expected.contentType = classification.contentType;
    if ("primaryTopic" in selected && classification.topics.length) expected.primaryTopic = classification.topics.map((item) => item.topicKey);
    return Object.keys(expected).length ? [{ decisionCallId: call.id, expected }] : [];
  });

  const labelsPath = arg("labels");
  const fileLabels = labelsPath ? validateLabels(JSON.parse(await readFile(path.resolve(labelsPath), "utf8"))) : [];
  const labelKey = (label: DecisionEvalLabel) => label.decisionCallId ? `id:${label.decisionCallId}` : `fingerprint:${label.requestFingerprint}`;
  const labels = new Map(manualLabels.map((label) => [labelKey(label), label]));
  for (const label of fileLabels) labels.set(labelKey(label), label);
  const labelFor = (call: { id: string; requestFingerprint: string | null }) =>
    labels.get(`id:${call.id}`) ?? (call.requestFingerprint ? labels.get(`fingerprint:${call.requestFingerprint}`) : undefined);

  const exportPath = arg("export");
  if (exportPath) {
    const destination = path.resolve(exportPath);
    const includeExcerpt = flag("include-excerpt");
    const cases = calls.filter((call) => call.ok).map((call) => ({
      decisionCallId: call.id,
      requestFingerprint: call.requestFingerprint,
      classificationId: call.classificationId,
      articleId: call.classification?.article?.id ?? null,
      createdAt: call.createdAt.toISOString(),
      model: call.model,
      title: call.classification?.article?.title ?? null,
      ...(includeExcerpt ? { excerpt: call.classification?.article?.rawText?.slice(0, 1_000) ?? null } : {}),
      selected: parseObject(call.selectedValue),
      baseline: parseObject(call.baselineValue),
      confidence: call.confidence,
      expected: labelFor(call)?.expected ?? Object.fromEntries(Object.keys(parseObject(call.selectedValue)).map((key) => [key, null])),
    }));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(cases, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ event: "classification.eval.exported", path: destination, cases: cases.length, includesExcerpt: includeExcerpt }));
  }

  console.log(JSON.stringify({
    event: "classification.eval.report",
    manualLabels: manualLabels.length,
    fileLabels: fileLabels.length,
    ...evaluateShadowLabels(calls, [...labels.values()]),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "classification.eval.failed", error: String(error).slice(0, 500) }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
