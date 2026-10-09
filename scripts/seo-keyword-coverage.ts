import "dotenv/config";
import keywordsJson from "../data/seo-keywords.json";
import { prisma } from "../src/lib/db";
import { tickerFromAssetSlug } from "../src/lib/assetPath";
import { publicationReadyWhere } from "../src/lib/publication";
import { getTopicStat } from "../src/lib/topics";
import { queryClassifiedArticleIds } from "../src/lib/classification/query";
import { taxonomy } from "../src/lib/classification/taxonomy";

type Priority = "P0" | "P1" | "P2";
type Locale = "en" | "zh-CN";
interface KeywordEntry {
  keyword: string;
  language: Locale;
  intent: string;
  topic: string;
  entity: string;
  target_url: string;
  supporting_terms: string[];
  source: string;
  evidence: string;
  priority: Priority;
  status: string;
  last_verified_at: string;
}

interface Coverage {
  targetUrl: string;
  kind: "asset" | "institution" | "subject_institution" | "topic" | "research" | "unknown";
  exists: boolean;
  indexable: boolean;
  reports: number;
  institutions: number;
  storedTargetsWithHorizon: number;
  latestPublishedAt: string | null;
  note: string;
}

const entries = keywordsJson as KeywordEntry[];
const REQUIRED = ["keyword", "language", "intent", "topic", "entity", "target_url", "supporting_terms", "source", "evidence", "priority", "status", "last_verified_at"] as const;

function validateConfig() {
  const errors: string[] = [];
  if (entries.length < 30 || entries.length > 50) errors.push(`expected 30-50 keywords, found ${entries.length}`);
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    for (const field of REQUIRED) if (!(field in entry)) errors.push(`row ${index + 1} missing ${field}`);
    const key = `${entry.language}:${entry.keyword.normalize("NFKC").toLocaleLowerCase()}`;
    if (seen.has(key)) errors.push(`duplicate keyword: ${key}`);
    seen.add(key);
    if (!(["en", "zh-CN"] as string[]).includes(entry.language)) errors.push(`invalid language for ${entry.keyword}`);
    if (!(["P0", "P1", "P2"] as string[]).includes(entry.priority)) errors.push(`invalid priority for ${entry.keyword}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.last_verified_at)) errors.push(`invalid last_verified_at for ${entry.keyword}`);
    if (entry.target_url && !entry.target_url.startsWith("/")) errors.push(`target_url must be root-relative for ${entry.keyword}`);
    if (entry.status === "content_gap" && entry.target_url) errors.push(`content_gap must not claim a target URL: ${entry.keyword}`);
  }
  const targetsByIntent = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.target_url) continue;
    const key = `${entry.language}:${entry.topic}:${entry.intent}`;
    const targets = targetsByIntent.get(key) ?? new Set<string>();
    targets.add(entry.target_url);
    targetsByIntent.set(key, targets);
  }
  for (const [intent, targets] of targetsByIntent) if (targets.size > 1) errors.push(`intent maps to multiple pages: ${intent} -> ${[...targets].join(", ")}`);
  if (errors.length) throw new Error(errors.join("\n"));
}

async function assetCoverage(path: string): Promise<Coverage> {
  const slug = path.slice("/markets/".length);
  const asset = await prisma.asset.findUnique({
    where: { ticker: tickerFromAssetSlug(slug) },
    select: {
      ticker: true,
      articleAssets: {
        where: { article: publicationReadyWhere() },
        select: {
          target: true,
          timeHorizon: true,
          article: { select: { institutionId: true, publishedAt: true } },
        },
      },
    },
  });
  if (!asset) return { targetUrl: path, kind: "asset", exists: false, indexable: false, reports: 0, institutions: 0, storedTargetsWithHorizon: 0, latestPublishedAt: null, note: "asset row missing" };
  const institutions = new Set(asset.articleAssets.map((row) => row.article.institutionId)).size;
  const latest = asset.articleAssets.reduce<Date | null>((value, row) => !value || row.article.publishedAt > value ? row.article.publishedAt : value, null);
  return {
    targetUrl: path,
    kind: "asset",
    exists: true,
    indexable: institutions >= 2,
    reports: asset.articleAssets.length,
    institutions,
    storedTargetsWithHorizon: asset.articleAssets.filter((row) => row.target !== null && Boolean(row.timeHorizon)).length,
    latestPublishedAt: latest?.toISOString() ?? null,
    note: institutions >= 2 ? "meets the asset indexability threshold" : "fewer than two publishing institutions",
  };
}

async function institutionCoverage(path: string): Promise<Coverage> {
  const slug = path.slice("/institution/".length);
  const institution = await prisma.institution.findUnique({
    where: { slug },
    select: {
      id: true,
      articles: { where: publicationReadyWhere(), select: { publishedAt: true } },
    },
  });
  if (institution) {
    const latest = institution.articles.reduce<Date | null>((value, row) => !value || row.publishedAt > value ? row.publishedAt : value, null);
    return {
      targetUrl: path,
      kind: "institution",
      exists: true,
      indexable: institution.articles.length > 0,
      reports: institution.articles.length,
      institutions: 1,
      storedTargetsWithHorizon: 0,
      latestPublishedAt: latest?.toISOString() ?? null,
      note: institution.articles.length ? "publisher page has publication-ready reports" : "publisher exists without publication-ready reports",
    };
  }
  const subject = taxonomy.institutions.find((item) => item.key === slug);
  if (!subject) return { targetUrl: path, kind: "institution", exists: false, indexable: false, reports: 0, institutions: 0, storedTargetsWithHorizon: 0, latestPublishedAt: null, note: "institution and classified subject missing" };
  const articleIds = await queryClassifiedArticleIds({ institutions: [slug] });
  const rows = articleIds.length ? await prisma.article.findMany({
    where: publicationReadyWhere({ id: { in: articleIds } }),
    select: { publishedAt: true, institutionId: true },
  }) : [];
  const latest = rows.reduce<Date | null>((value, row) => !value || row.publishedAt > value ? row.publishedAt : value, null);
  return {
    targetUrl: path,
    kind: "subject_institution",
    exists: true,
    indexable: rows.length > 0,
    reports: rows.length,
    institutions: new Set(rows.map((row) => row.institutionId)).size,
    storedTargetsWithHorizon: 0,
    latestPublishedAt: latest?.toISOString() ?? null,
    note: rows.length ? "classified subject page has publication-ready reports" : "subject exists without publication-ready reports",
  };
}

async function coverageFor(path: string): Promise<Coverage> {
  if (path.startsWith("/markets/")) return assetCoverage(path);
  if (path.startsWith("/institution/")) return institutionCoverage(path);
  if (path.startsWith("/topics/")) {
    const stat = await getTopicStat(path.slice("/topics/".length));
    return { targetUrl: path, kind: "topic", exists: Boolean(stat), indexable: Boolean(stat), reports: stat?.articles ?? 0, institutions: stat?.institutions ?? 0, storedTargetsWithHorizon: 0, latestPublishedAt: stat?.lastAt.toISOString() ?? null, note: stat ? "meets topic thresholds" : "topic does not meet corpus thresholds" };
  }
  if (path === "/research") {
    const [reports, latest] = await Promise.all([
      prisma.article.count({ where: publicationReadyWhere() }),
      prisma.article.findFirst({ where: publicationReadyWhere(), orderBy: { publishedAt: "desc" }, select: { publishedAt: true } }),
    ]);
    return { targetUrl: path, kind: "research", exists: true, indexable: reports > 0, reports, institutions: 0, storedTargetsWithHorizon: 0, latestPublishedAt: latest?.publishedAt.toISOString() ?? null, note: "publication-ready research feed" };
  }
  return { targetUrl: path, kind: "unknown", exists: false, indexable: false, reports: 0, institutions: 0, storedTargetsWithHorizon: 0, latestPublishedAt: null, note: "unsupported route type" };
}

async function main() {
  validateConfig();
  const targets = [...new Set(entries.map((entry) => entry.target_url).filter(Boolean))].sort();
  const coverage = await Promise.all(targets.map(coverageFor));
  const coverageByPath = new Map(coverage.map((row) => [row.targetUrl, row]));
  const mappedToNonIndexable = entries.filter((entry) => entry.target_url && !coverageByPath.get(entry.target_url)?.indexable);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "read_only",
    config: {
      keywords: entries.length,
      gscObserved: entries.filter((entry) => entry.source === "gsc_observed_user_supplied").length,
      candidates: entries.filter((entry) => entry.source !== "gsc_observed_user_supplied").length,
      priorities: Object.fromEntries((["P0", "P1", "P2"] as const).map((priority) => [priority, entries.filter((entry) => entry.priority === priority).length])),
      contentGaps: entries.filter((entry) => entry.status === "content_gap").length,
      uniqueMappedTargets: targets.length,
    },
    coverage,
    checks: {
      configValid: true,
      onePagePerIntent: true,
      mappedTargetsIndexable: mappedToNonIndexable.length === 0,
      nonIndexableMappings: mappedToNonIndexable.map((entry) => ({ keyword: entry.keyword, targetUrl: entry.target_url })),
      searchVolume: "unknown",
      keywordDifficulty: "unknown",
      growthForecast: "unknown",
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (mappedToNonIndexable.length) process.exitCode = 2;
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
