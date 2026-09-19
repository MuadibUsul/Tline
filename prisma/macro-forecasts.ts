import "dotenv/config";
import { prisma } from "../src/lib/db";
import { resolveLLMProvider } from "../src/lib/llm/config";
import type { LLMProvider } from "../src/lib/llm/provider";
import { extractForecasts, FORECAST_PROMPT_VERSION } from "../src/lib/macro/forecasts";
import { generatePendingReleaseAnalyses } from "../src/lib/macro/releaseAnalysis";
import { CONTEXT_BUILDER_VERSION } from "../src/lib/llm/context-builder";
import { decideAiExecution, hasCompletedAiExecution, hasRecordedAiExecution, recordAiExecutionEvent } from "../src/lib/llm/execution-policy";

// Expectations pipeline: mine institution forecasts from recent research previews, then
// generate the release read-out for prints that have landed. Automated, source-agnostic.
//   npm run macro:forecasts                 (extract + analyze)
//   npm run macro:forecasts -- --extract    (only mine forecasts)
//   npm run macro:forecasts -- --analyze    (only generate read-outs)
function arg(name: string) { return process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3); }
const flag = (name: string) => process.argv.includes(`--${name}`);

// Cheap prefilter so the LLM only sees articles that plausibly preview a tracked release.
const HINT = /\b(payrolls?|non-?farm|cpi|inflation|ppi|pce|jolts|gdp|unemployment|jobless|week ahead|preview|forecast|expect|consensus|estimate)\b|非农|通胀|失业|前瞻|预计|预期/i;

async function extractPhase(limit: number, provider: LLMProvider) {
  const since = new Date(Date.now() - 21 * 864e5);
  const articles = await prisma.article.findMany({
    where: { publishedAt: { gte: since }, rawText: { not: null } },
    select: { id: true, title: true, contentHash: true, rawText: true, publishedAt: true, institutionId: true },
    orderBy: { publishedAt: "desc" },
    take: limit * 5,
  });
  const existing = new Set((await prisma.macroForecast.findMany({
    where: { articleId: { in: articles.map((article) => article.id) } },
    select: { articleId: true },
  })).flatMap((row) => row.articleId ? [row.articleId] : []));
  let scanned = 0, stored = 0;
  for (const article of articles) {
    if (scanned >= limit) break;
    if (!HINT.test(`${article.title} ${article.rawText?.slice(0, 2500) ?? ""}`)) continue;
    const policy = decideAiExecution({
      taskType: "forecast", contentId: article.id, contentHash: article.contentHash,
      promptVersion: FORECAST_PROMPT_VERSION, contextBuilderVersion: CONTEXT_BUILDER_VERSION,
      requestedOutput: "forecast", route: { provider: provider.name, model: provider.model },
      ...(existing.has(article.id) ? { existingArtifacts: { reusable: true } } : {}),
    });
    if (existing.has(article.id)) {
      if (!(await hasRecordedAiExecution(policy.fingerprint, "HIT"))) {
        await recordAiExecutionEvent({ task: "forecast", contentId: article.id, policy, cacheStatus: "HIT", attribution: "ARTIFACT_REUSE" });
      }
      continue;
    }
    if (await hasCompletedAiExecution(policy.fingerprint)) continue;
    scanned++;
    try {
      const forecasts = await extractForecasts(article.title, article.rawText ?? "", provider, { contentId: article.id, contentHash: article.contentHash });
      for (const forecast of forecasts) {
        // Articles are processed newest-first, so the first row per (institution, indicator,
        // period) is the latest — keep it and no-op on older duplicates.
        await prisma.macroForecast.upsert({
          where: { institutionId_indicatorKey_referencePeriod: { institutionId: article.institutionId, indicatorKey: forecast.indicatorKey, referencePeriod: forecast.referencePeriod } },
          create: { institutionId: article.institutionId, indicatorKey: forecast.indicatorKey, referencePeriod: forecast.referencePeriod, value: forecast.value, unit: forecast.unit, quote: forecast.quote, articleId: article.id, asOf: article.publishedAt },
          update: {},
        });
        stored++;
      }
      if (forecasts.length) console.log(`  +${forecasts.length} ${article.title.slice(0, 56)}`);
    } catch (error) {
      console.error(`  FAIL ${article.id} · ${String(error).slice(0, 120)}`);
    }
  }
  console.log(`Extraction: scanned ${scanned} previews · stored ${stored} forecasts.`);
}

// Delegated rather than re-querying here: generatePendingReleaseAnalyses owns the retry
// counter and the backoff window, and a second selection path that skipped them would
// re-bill every failing release on whatever cadence this script happens to run at.
async function analyzePhase(limit: number) {
  const done = await generatePendingReleaseAnalyses(limit);
  console.log(`Analysis: generated ${done} read-out(s).`);
}

async function main() {
  const provider = await resolveLLMProvider("forecast");
  if (!provider) { console.log("No model provider is configured for forecast extraction."); return; }
  const limit = Math.max(1, Number(arg("limit") || 40));
  const onlyExtract = flag("extract");
  const onlyAnalyze = flag("analyze");
  if (!onlyAnalyze) await extractPhase(limit, provider);
  if (!onlyExtract) await analyzePhase(Math.min(20, limit));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
