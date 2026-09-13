import "dotenv/config";
import { prisma } from "../src/lib/db";
import { EXPECTATION_TYPES, recordMacroExpectation, type ExpectationType } from "../src/lib/macro/expectations";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const required = (name: string) => {
  const value = args.get(name)?.trim();
  if (!value) throw new Error(`--${name}=... is required.`);
  return value;
};
const date = (name: string) => {
  const value = new Date(required(name));
  if (Number.isNaN(value.getTime())) throw new Error(`--${name} must be an ISO timestamp/date.`);
  return value;
};

async function main() {
  const releaseRef = required("release");
  const canonicalKey = required("indicator");
  const type = required("type") as ExpectationType;
  if (!EXPECTATION_TYPES.includes(type)) throw new Error(`--type must be ${EXPECTATION_TYPES.join(", ")}.`);
  const release = await prisma.macroRelease.findFirst({ where: { OR: [{ id: releaseRef }, { releaseKey: releaseRef }] } });
  if (!release) throw new Error(`Release not found: ${releaseRef}`);
  const indicator = await prisma.macroIndicator.findUnique({ where: { canonicalKey } });
  if (!indicator) throw new Error(`Indicator not found: ${canonicalKey}`);
  const capturedAt = date("captured-at");
  const historicalReconstruction = args.get("historical") === "true";
  if (capturedAt > release.scheduledAt && !historicalReconstruction) {
    throw new Error("Post-release entries must use --historical=true and can never become the live release snapshot.");
  }
  const input = {
    releaseId: release.id,
    indicatorId: indicator.id,
    referencePeriod: date("period"),
    releaseStage: args.get("stage") ?? "INITIAL",
    type,
    source: required("source"),
    sourceEventId: args.get("source-event-id"),
    rawField: args.get("raw-field"),
    sourceUrl: required("source-url"),
    licenseKey: required("license-key"),
    value: required("value"),
    unit: args.get("unit") ?? indicator.unit,
    seasonalAdjustment: args.get("seasonal-adjustment") ?? indicator.seasonalAdjustment,
    annualization: args.get("annualization"),
    sourcePublishedAt: args.has("source-published-at") ? date("source-published-at") : null,
    capturedAt,
    sampleSize: args.has("sample-size") ? Number(args.get("sample-size")) : null,
    surveyMethod: args.get("survey-method"),
    entryMethod: "CLI",
    operatorId: args.get("operator") ?? process.env.USERNAME ?? "unknown",
    historicalReconstruction,
  };
  if (args.get("dry-run") === "true") {
    console.log(JSON.stringify({ dryRun: true, release: release.releaseKey, indicator: canonicalKey, ...input }, null, 2));
    return;
  }
  const saved = await recordMacroExpectation(input);
  console.log(JSON.stringify({ saved: true, id: saved.id, revisionNo: saved.revisionNo }));
}

main().catch((error) => { console.error(String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
