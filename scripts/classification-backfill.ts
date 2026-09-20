import "dotenv/config";
import { prisma } from "../src/lib/db";
import { classifyDeterministically } from "../src/lib/classification/classifier";
import { discoverArticleClassification } from "../src/lib/classification/discovery";
import { articleClassificationSourceFingerprint, persistDeterministicClassification, type ClassificationTarget } from "../src/lib/classification/store";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes("--apply");
const kind = arg("kind") ?? "all";
const cursor = arg("cursor");
const limit = Math.min(1000, Math.max(1, Number(arg("limit") || 200)));
const allowedKinds = new Set(["all", "article", "indicator", "release", "policy"]);
if (!allowedKinds.has(kind)) throw new Error("--kind must be all, article, indicator, release, or policy");
if (cursor && kind === "all") throw new Error("--cursor requires one explicit --kind");

type Status = Awaited<ReturnType<typeof persistDeterministicClassification>>;
const metrics: Record<Status | "failed", number> = { planned: 0, created: 0, updated: 0, reused: 0, manual: 0, failed: 0 };
let nextCursor: string | null = null;

async function store(target: ClassificationTarget, sourceFingerprint: string, result: ReturnType<typeof classifyDeterministically>) {
  try { metrics[await persistDeterministicClassification({ target, result, sourceFingerprint, apply })]++; }
  catch (error) { metrics.failed++; console.error(JSON.stringify({ event: "classification.backfill.item.failed", kind: target.kind, id: target.id, error: String(error).slice(0, 300) })); }
  nextCursor = target.id;
}

async function articles() {
  const rows = await prisma.article.findMany({
    where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: "asc" }, take: limit,
    include: { articleAssets: { include: { asset: { select: { ticker: true } } } } },
  });
  for (const row of rows) await store(
    { kind: "ARTICLE", id: row.id }, articleClassificationSourceFingerprint(row.contentHash, row.titleHash, row.articleAssets.map((item) => item.asset.ticker)),
    classifyDeterministically(discoverArticleClassification({
      title: row.title,
      text: row.rawText ?? "",
      assetTickers: row.articleAssets.map((item) => item.asset.ticker),
    })),
  );
}

async function indicators() {
  const rows = await prisma.macroIndicator.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: "asc" }, take: limit });
  for (const row of rows) await store(
    { kind: "MACRO_INDICATOR", id: row.id }, `${row.updatedAt.toISOString()}:${row.countryCode}:${row.category}`,
    classifyDeterministically({ structuredMetadata: { countryCode: row.countryCode, category: row.category, contentType: "MACRO_INDICATOR" } }),
  );
}

async function releases() {
  const rows = await prisma.macroRelease.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: "asc" }, take: limit });
  for (const row of rows) await store(
    { kind: "MACRO_RELEASE", id: row.id }, `${row.updatedAt.toISOString()}:${row.countryCode}:${row.releaseFamily}:${row.agency}`,
    classifyDeterministically({ structuredMetadata: { countryCode: row.countryCode, releaseFamily: row.releaseFamily, agency: row.agency, contentType: "MACRO_RELEASE" } }),
  );
}

async function policies() {
  const rows = await prisma.macroPolicyDocument.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: "asc" }, take: limit });
  for (const row of rows) await store(
    { kind: "POLICY_DOCUMENT", id: row.id }, row.contentHash,
    classifyDeterministically({ institutions: [row.centralBank], contentType: "POLICY_DOCUMENT" }),
  );
}

async function main() {
  if (kind === "all" || kind === "article") await articles();
  if (kind === "all" || kind === "indicator") await indicators();
  if (kind === "all" || kind === "release") await releases();
  if (kind === "all" || kind === "policy") await policies();
  console.log(JSON.stringify({ event: apply ? "classification.backfill.applied" : "classification.backfill.preview", kind, limit, nextCursor, metrics }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
