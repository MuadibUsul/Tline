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
 * the only guard was a list of bare words. These are not the institution's headline in any
 * sense, so a page carrying one has no subject a searcher could have been looking for.
 */
const NOISE_TITLE = /^(?:pdf|document|attachment|file)\b|(?:^|\b)(?:of entire text|full document|entire document)\b|uploaded (?:document|file)|^untitled\b/i;
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

function hasEntries(value: string | null | undefined) {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed);
  } catch {
    return value.trim().length > 0;
  }
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
  // A report whose analysis carries no conclusion, no arguments, no numbers and no risks
  // adds nothing to the source it points at. The source text alone is the publisher's work,
  // so the page has no independent value to rank on — it stays reachable and out of the index.
  // Only evaluated when the caller actually selected those columns: an absent column is not
  // an empty one, and treating it as empty would take the whole corpus out of the index.
  const a = article.analysis;
  if (a
    && (a.keyArguments !== undefined || a.keyNumbers !== undefined || a.risks !== undefined || a.interpretation !== undefined)
    && !hasEntries(a.keyArguments) && !hasEntries(a.keyNumbers) && !hasEntries(a.risks) && !hasEntries(a.interpretation)) {
    issues.push("no_structured_analysis");
  }

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
