import "dotenv/config";
import { prisma } from "../src/lib/db";
import { isNoiseTitle } from "../src/lib/contentQuality";
import { validateStructuredResearch, type StructuredQualityIssueCode } from "../src/lib/ingest/researchQuality";

type Anomaly = { id: string; slug: string; title: string; institution: string; codes: string[] };
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const sampleSize = Math.max(50, Number(arg("sample") || 60));
const verifySourceCount = Math.max(0, Number(arg("verify-sources") || 0));
const anomalyLimit = Math.max(1, Number(arg("anomaly-limit") || 100));
const MOJIBAKE = /\uFFFD|(?:Ã.|Â.|â(?:€|™|œ))/;
const HAN = /\p{Script=Han}/u;
const normalize = (value: string) => value.normalize("NFKC").replace(/[\s\u00a0]+/g, " ").trim().toLocaleLowerCase();
const parse = <T,>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

function normalizedSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|ref$|source$|campaign$)/i.test(key)) url.searchParams.delete(key);
    url.hostname = url.hostname.toLocaleLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return value.trim().toLocaleLowerCase(); }
}

function duplicateKeys<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    (groups.get(value) ?? groups.set(value, []).get(value)!).push(row);
  }
  return new Set([...groups.values()].filter((group) => group.length > 1).flat());
}

async function verifySource(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal, headers: { "user-agent": "TlinesQualityAudit/1.0 (+https://tlines.tech)" } });
    if ([403, 405, 406].includes(response.status)) {
      response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal, headers: { "user-agent": "TlinesQualityAudit/1.0 (+https://tlines.tech)", range: "bytes=0-1024" } });
    }
    return { url, status: response.status, ok: response.ok, finalUrl: response.url, redirected: response.url !== url, error: null };
  } catch (error) {
    return { url, status: null, ok: false, finalUrl: null, redirected: false, error: String(error).slice(0, 160) };
  } finally { clearTimeout(timeout); }
}

async function main() {
  const rows = await prisma.article.findMany({
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    select: {
      id: true, slug: true, title: true, sourceUrl: true, language: true, publishedAt: true,
      contentHash: true, rawText: true, disclaimerText: true, indexableEn: true, indexableZh: true,
      institution: { select: { id: true, name: true } },
      analysis: { select: {
        summary: true, summaryZh: true, keyArguments: true, keyArgumentsZh: true,
        keyNumbers: true, keyNumbersZh: true, risks: true, risksZh: true,
        interpretation: true, interpretationZh: true, reviewStatus: true,
      } },
      translations: { where: { locale: "zh-CN" }, take: 1, select: { status: true, qualityScore: true } },
      articleAssets: { select: { target: true, previousTarget: true, timeHorizon: true, asset: { select: { ticker: true } } } },
      atomicViews: { select: { sourceQuote: true, timeHorizon: true, value: true, reviewStatus: true } },
    },
  });

  const duplicateUrl = duplicateKeys(rows, (row) => normalizedSourceUrl(row.sourceUrl));
  const duplicateBody = duplicateKeys(rows, (row) => row.contentHash);
  const duplicateEdition = duplicateKeys(rows, (row) => `${row.institution.id}:${normalize(row.title)}:${row.publishedAt.toISOString().slice(0, 10)}`);
  const anomalyRows: Anomaly[] = [];
  const issueCounts = new Map<string, number>();
  const addCount = (code: string) => issueCounts.set(code, (issueCounts.get(code) ?? 0) + 1);
  let analyses = 0;
  let groundedAnalyses = 0;
  let sourceBackedQuotes = 0;
  let totalQuotes = 0;
  let completeTargets = 0;
  let incompleteTargets = 0;

  for (const row of rows) {
    const codes = new Set<string>();
    const add = (code: string) => { codes.add(code); };
    const body = row.rawText?.trim() ?? "";
    if (isNoiseTitle(row.title)) add("damaged_or_placeholder_title");
    if (MOJIBAKE.test(`${row.title}\n${body.slice(0, 5_000)}`)) add("mojibake");
    if (/[…]|\.{3}$/.test(row.title.trim())) add("possibly_truncated_title");
    if (!/^https?:\/\//i.test(row.sourceUrl)) add("invalid_source_url");
    if (row.publishedAt.getTime() > Date.now() + 36e5) add("future_publication_date");
    if (body.length < 300) add("thin_body");
    if (row.language === "en" && HAN.test(row.title)) add("language_mismatch");
    if (duplicateUrl.has(row)) add("duplicate_normalized_source_url");
    if (duplicateBody.has(row)) add("duplicate_content_hash");
    if (duplicateEdition.has(row)) add("duplicate_institution_title_date");

    if (row.analysis) {
      analyses += 1;
      const fields = {
        summary: row.analysis.summary,
        summaryZh: row.analysis.summaryZh,
        keyArguments: parse<string[]>(row.analysis.keyArguments, []),
        keyArgumentsZh: parse<string[]>(row.analysis.keyArgumentsZh, []),
        keyNumbers: parse<Array<{ label?: string; value?: string }>>(row.analysis.keyNumbers, []),
        keyNumbersZh: parse<Array<{ label?: string; value?: string }>>(row.analysis.keyNumbersZh, []),
        risks: parse<string[]>(row.analysis.risks, []),
        risksZh: parse<string[]>(row.analysis.risksZh, []),
        interpretation: row.analysis.interpretation,
        interpretationZh: row.analysis.interpretationZh,
      };
      const quality = validateStructuredResearch(fields, body, row.articleAssets.map((asset) => ({
        ticker: asset.asset.ticker, target: asset.target, previousTarget: asset.previousTarget, timeHorizon: asset.timeHorizon,
      })));
      if (quality.passed) groundedAnalyses += 1;
      for (const issue of quality.issues) add(issue.code satisfies StructuredQualityIssueCode);
      if (row.analysis.reviewStatus !== "ok") add("analysis_needs_review");
    } else add("analysis_missing");

    for (const asset of row.articleAssets) {
      if (asset.target === null && asset.previousTarget === null) continue;
      if (asset.timeHorizon) completeTargets += 1;
      else { incompleteTargets += 1; add("stored_target_missing_horizon"); }
    }
    const normalizedBody = normalize(body);
    for (const view of row.atomicViews) {
      totalQuotes += 1;
      if (view.sourceQuote && normalizedBody.includes(normalize(view.sourceQuote))) sourceBackedQuotes += 1;
      else add("atomic_quote_not_in_source");
      if (view.value && (!view.timeHorizon || view.timeHorizon === "unspecified")) add("atomic_value_missing_horizon");
    }

    if (codes.size) {
      for (const code of codes) addCount(code);
      anomalyRows.push({ id: row.id, slug: row.slug, title: row.title, institution: row.institution.name, codes: [...codes].sort() });
    }
  }

  // Build a stable regression sample that first spans institutions, translated/untranslated
  // records, assets and anomaly classes, then fills newest-first. No database row is changed.
  const chosen = new Map<string, typeof rows[number]>();
  const takeFirst = (items: typeof rows) => { for (const row of items) if (chosen.size < sampleSize && !chosen.has(row.id)) chosen.set(row.id, row); };
  takeFirst(rows.filter((row) => row.translations.length > 0).slice(0, 10));
  takeFirst(rows.filter((row) => row.translations.length === 0).slice(0, 10));
  takeFirst([...new Map(rows.map((row) => [row.institution.id, row])).values()]);
  const assetFirst = new Map<string, typeof rows[number]>();
  for (const row of rows) for (const asset of row.articleAssets) if (!assetFirst.has(asset.asset.ticker)) assetFirst.set(asset.asset.ticker, row);
  takeFirst([...assetFirst.values()]);
  const anomalyIds = new Set(anomalyRows.map((row) => row.id));
  takeFirst(rows.filter((row) => anomalyIds.has(row.id)));
  takeFirst(rows);

  const sample = [...chosen.values()];
  const sourceChecks = verifySourceCount > 0
    ? await Promise.all(sample.slice(0, verifySourceCount).map((row) => verifySource(row.sourceUrl)))
    : [];
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "read_only",
    population: {
      articles: rows.length,
      institutions: new Set(rows.map((row) => row.institution.id)).size,
      sourceLanguages: Object.fromEntries([...new Set(rows.map((row) => row.language))].sort().map((language) => [language, rows.filter((row) => row.language === language).length])),
      withChineseTranslation: rows.filter((row) => row.translations.length > 0).length,
      withAssets: rows.filter((row) => row.articleAssets.length > 0).length,
      indexableEnglish: rows.filter((row) => row.indexableEn).length,
      indexableChinese: rows.filter((row) => row.indexableZh).length,
    },
    quality: {
      analyses,
      analysesPassingCurrentStructuredRules: groundedAnalyses,
      analysesPassingRate: analyses ? Number((groundedAnalyses / analyses).toFixed(4)) : 0,
      atomicQuotes: totalQuotes,
      atomicQuotesFoundInSource: sourceBackedQuotes,
      atomicQuoteGroundingRate: totalQuotes ? Number((sourceBackedQuotes / totalQuotes).toFixed(4)) : 0,
      targetsWithHorizon: completeTargets,
      targetsMissingHorizon: incompleteTargets,
      anomalyArticles: anomalyRows.length,
      issuesByCode: Object.fromEntries([...issueCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    },
    regressionSample: {
      requested: sampleSize,
      selected: sample.length,
      institutions: new Set(sample.map((row) => row.institution.id)).size,
      withChineseTranslation: sample.filter((row) => row.translations.length > 0).length,
      withoutChineseTranslation: sample.filter((row) => row.translations.length === 0).length,
      assets: new Set(sample.flatMap((row) => row.articleAssets.map((asset) => asset.asset.ticker))).size,
      sourceLanguages: Object.fromEntries([...new Set(sample.map((row) => row.language))].sort().map((language) => [language, sample.filter((row) => row.language === language).length])),
      ids: sample.map((row) => row.id),
    },
    copyrightAndTransparency: {
      sourceLinksPresent: rows.filter((row) => /^https?:\/\//i.test(row.sourceUrl)).length,
      publisherBodyDisplayRightsTracking: "not_represented_in_article_or_institution_schema",
      decision: "manual_review_required_before_expanding_original-text-display",
    },
    sourceVerification: {
      requested: verifySourceCount,
      checked: sourceChecks.length,
      reachable: sourceChecks.filter((result) => result.ok).length,
      redirected: sourceChecks.filter((result) => result.redirected).length,
      failed: sourceChecks.filter((result) => !result.ok).length,
      results: sourceChecks,
    },
    anomalies: anomalyRows.slice(0, anomalyLimit),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
