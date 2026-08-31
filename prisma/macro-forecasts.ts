import "dotenv/config";
import { prisma } from "../src/lib/db";
import { getLLMProvider } from "../src/lib/llm/provider";
import { extractForecasts } from "../src/lib/macro/forecasts";
import { generateReleaseAnalysis } from "../src/lib/macro/releaseAnalysis";

// Expectations pipeline: mine institution forecasts from recent research previews, then
// generate the release read-out for prints that have landed. Automated, source-agnostic.
//   npm run macro:forecasts                 (extract + analyze)
//   npm run macro:forecasts -- --extract    (only mine forecasts)
//   npm run macro:forecasts -- --analyze    (only generate read-outs)
function arg(name: string) { return process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3); }
const flag = (name: string) => process.argv.includes(`--${name}`);

// Cheap prefilter so the LLM only sees articles that plausibly preview a tracked release.
const HINT = /\b(payrolls?|non-?farm|cpi|inflation|ppi|pce|jolts|gdp|unemployment|jobless|week ahead|preview|forecast|expect|consensus|estimate)\b|非农|通胀|失业|前瞻|预计|预期/i;

async function extractPhase(limit: number, provider: ReturnType<typeof getLLMProvider>) {
  const since = new Date(Date.now() - 21 * 864e5);
  const articles = await prisma.article.findMany({
    where: { publishedAt: { gte: since }, rawText: { not: null } },
    select: { id: true, title: true, rawText: true, publishedAt: true, institutionId: true },
    orderBy: { publishedAt: "desc" },
    take: limit * 5,
  });
  let scanned = 0, stored = 0;
  for (const article of articles) {
    if (scanned >= limit) break;
    if (!HINT.test(`${article.title} ${article.rawText?.slice(0, 2500) ?? ""}`)) continue;
    scanned++;
    try {
      const forecasts = await extractForecasts(article.title, article.rawText ?? "", provider ?? undefined);
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

async function analyzePhase(limit: number, provider: ReturnType<typeof getLLMProvider>) {
  const releases = await prisma.macroRelease.findMany({
    where: { status: "RELEASED", analysisAt: null, values: { some: {} } },
    orderBy: { releasedAt: "desc" },
    take: limit,
    select: { id: true, titleEn: true },
  });
  let done = 0;
  for (const release of releases) {
    try {
      if (await generateReleaseAnalysis(release.id, provider ?? undefined)) { done++; console.log(`  analyzed ${release.titleEn}`); }
    } catch (error) {
      console.error(`  FAIL ${release.id} · ${String(error).slice(0, 120)}`);
    }
  }
  console.log(`Analysis: generated ${done} read-out(s).`);
}

async function main() {
  const provider = getLLMProvider(process.env.FORECAST_PROVIDER ?? process.env.TRANSLATION_PROVIDER);
  if (!provider) { console.log("No LLM provider configured."); return; }
  const limit = Math.max(1, Number(arg("limit") || 40));
  const onlyExtract = flag("extract");
  const onlyAnalyze = flag("analyze");
  if (!onlyAnalyze) await extractPhase(limit, provider);
  if (!onlyExtract) await analyzePhase(Math.min(20, limit), provider);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
