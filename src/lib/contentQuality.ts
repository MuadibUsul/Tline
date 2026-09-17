import type { Locale } from "./i18n";

export interface IndexableArticleInput {
  title: string;
  rawText: string | null;
  sourceUrl: string;
  language: string;
  analysis?: {
    summary: string; summaryZh?: string | null; reviewStatus: string;
    keyArguments?: string | null; keyNumbers?: string | null; risks?: string | null; interpretation?: string | null;
  } | null;
  translations?: Array<{ title: string; text?: string; qualityScore: number | null; status: string }>;
}

export type IndexEligibility = "INDEX" | "NOINDEX_FOLLOW" | "NOT_GENERATED";
export interface ContentQualityResult { indexable: boolean; eligibility: IndexEligibility; issues: string[] }

const MOJIBAKE = /\uFFFD|(?:Ã.|Â.|â(?:€|€™|€œ|€œ))/;
const BAD_TITLE = /^(?:untitled|title|document|report|research|go to article|download(?: the)? (?:pdf|report|document)|无标题)$/i;
/**
 * Titles that are document labels rather than headlines.
 *
 * Extraction reads a PDF's first lines and occasionally returns the file caption: a report
 * page went live titled "PDF 777 Kb" and another "file of entire text", both indexed, because
 * the only guard was a list of bare words. A third went live as "Download the PDF \"Ongoing
 * Developments Part 1\"" — its real subject, EU and UK financial services regulation, was
 * only in the schema's isBasedOn. These are not the institution's headline in any sense, so
 * a page carrying one has no subject a searcher could have been looking for.
 *
 * The action verb is required to sit at the start, and only the file nouns are listed: a real
 * headline beginning "Download the report on Q3 earnings" is not a label for a document, and
 * is left alone.
 */
const NOISE_TITLE = /^(?:pdf|document|attachment|file)\b|^(?:download|view|open|read|get|fetch|see)\s+(?:the\s+|this\s+)?(?:pdf|document|attachment|file)\b|(?:^|\b)(?:of entire text|full document|entire document)\b|uploaded (?:document|file)|^untitled\b/i;
const DOC_SIZE_LABEL = /\b(?:pdf|document|file)\b[^a-z]{0,20}\b\d+\s*(?:kb|mb|k|m)\b/i;
const HAN = /\p{Script=Han}/u;
const COMMON_COMPOUNDS = new Set(["viewpoint", "investment", "institution", "institutional", "research", "outlook", "forecast", "consensus", "economics", "strategy"]);

/** True when a title is a document caption, a size label, or too short to be a subject. */
export function isNoiseTitle(title: string) {
  const clean = title.trim();
  if (BAD_TITLE.test(clean)) return true;
  if (NOISE_TITLE.test(clean)) return true;
  if (DOC_SIZE_LABEL.test(clean)) return true;
  return (clean.match(/\p{L}/gu) ?? []).length < 6;
}

function hasBrokenWord(value: string) {
  const words = value.match(/[A-Za-z]+/g) ?? [];
  for (let start = 0; start < words.length; start++) for (let size = 2; size <= 5 && start + size <= words.length; size++) {
    const parts = words.slice(start, start + size);
    if (parts.some((part) => part.length <= 2) && COMMON_COMPOUNDS.has(parts.join("").toLowerCase())) return true;
  }
  return false;
}

export function contentQuality(article: IndexableArticleInput, locale: Locale): ContentQualityResult {
  const issues: string[] = [];
  const title = article.title.trim();
  const body = article.rawText?.trim() ?? "";
  const summary = locale === "zh-CN" ? article.analysis?.summaryZh?.trim() : article.analysis?.summary.trim();
  const translation = article.translations?.[0];

  if (title.length < 8 || title.length > 180 || isNoiseTitle(title)) issues.push("abnormal_title");
  if (MOJIBAKE.test(`${title}\n${body.slice(0, 5000)}`) || hasBrokenWord(`${title}\n${body.slice(0, 5000)}`)) issues.push("garbled_or_broken_words");
  if (body.length < 300) issues.push("thin_content");
  if (!summary) issues.push("empty_summary");
  if (!article.sourceUrl || !/^https?:\/\//i.test(article.sourceUrl)) issues.push("missing_source");
  if (article.language === "en" && HAN.test(title)) issues.push("source_language_mismatch");
  if (article.analysis && article.analysis.reviewStatus !== "ok") issues.push("analysis_needs_review");
  /**
   * There was a rule here that withheld a report whose analysis carried no key arguments,
   * numbers, risks or interpretation, on the reasoning that the source text alone is the
   * publisher's work and the page had nothing of its own to rank on.
   *
   * Production measured it at 17% of report pages, and the pages it caught were not the ones
   * it was written for: they carried a Tlines-written conclusion and thousands of words, and
   * a whole legitimate class — the market-commentary roundup, which makes no falsifiable call
   * — has empty arrays by nature. A rule that takes one page in six out of the index on an
   * assumption the data does not support is worse than no rule; the genuinely empty case is
   * already covered by empty_summary and thin_content below.
   */

  if (locale === "zh-CN") {
    if (!translation?.title.trim() || !translation.text?.trim()) issues.push("missing_translation");
    if (translation && !HAN.test(`${translation.title}\n${translation.text ?? ""}`)) issues.push("translation_language_mismatch");
    if (translation && (MOJIBAKE.test(`${translation.title}\n${translation.text ?? ""}`) || hasBrokenWord(`${translation.title}\n${translation.text ?? ""}`))) issues.push("translation_garbled");
    if (translation?.status === "needs_review") issues.push("translation_needs_review");
    if (translation?.qualityScore != null && translation.qualityScore < 0.8) issues.push("translation_below_threshold");
  }

  const essentialMissing = !title || !body || !article.sourceUrl;
  const eligibility: IndexEligibility = essentialMissing ? "NOT_GENERATED" : issues.length ? "NOINDEX_FOLLOW" : "INDEX";
  return { indexable: eligibility === "INDEX", eligibility, issues };
}
