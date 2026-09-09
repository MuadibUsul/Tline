import type { Locale } from "./i18n";

export interface IndexableArticleInput {
  title: string;
  rawText: string | null;
  sourceUrl: string;
  language: string;
  analysis?: { summary: string; summaryZh?: string | null; reviewStatus: string } | null;
  translations?: Array<{ title: string; text?: string; qualityScore: number | null; status: string }>;
}

export interface ContentQualityResult { indexable: boolean; issues: string[] }

const MOJIBAKE = /\uFFFD|(?:Ã.|Â.|â(?:€|€™|€œ|€œ))/;
const BAD_TITLE = /^(?:untitled|title|document|report|research|go to article|download(?: the)? (?:pdf|report|document)|无标题)$/i;
const HAN = /\p{Script=Han}/u;
const COMMON_COMPOUNDS = new Set(["viewpoint", "investment", "institution", "institutional", "research", "outlook", "forecast", "consensus", "economics", "strategy"]);

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

  if (title.length < 8 || title.length > 180 || BAD_TITLE.test(title)) issues.push("abnormal_title");
  if (MOJIBAKE.test(`${title}\n${body.slice(0, 5000)}`) || hasBrokenWord(`${title}\n${body.slice(0, 5000)}`)) issues.push("garbled_or_broken_words");
  if (body.length < 300) issues.push("thin_content");
  if (!summary) issues.push("empty_summary");
  if (!article.sourceUrl || !/^https?:\/\//i.test(article.sourceUrl)) issues.push("missing_source");
  if (article.language === "en" && HAN.test(title)) issues.push("source_language_mismatch");

  if (locale === "zh-CN") {
    if (!translation?.title.trim() || !translation.text?.trim()) issues.push("missing_translation");
    if (translation && !HAN.test(`${translation.title}\n${translation.text ?? ""}`)) issues.push("translation_language_mismatch");
    if (translation && (MOJIBAKE.test(`${translation.title}\n${translation.text ?? ""}`) || hasBrokenWord(`${translation.title}\n${translation.text ?? ""}`))) issues.push("translation_garbled");
  }

  return { indexable: issues.length === 0, issues };
}
