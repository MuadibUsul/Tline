import { extractArticle } from "../../ingest/extract";

/** Reuse the project's audited HTML article extractor; Fed releases are ordinary public HTML pages. */
export function extractPolicyText(html: string): { rawText: string; publishedAt: Date | null } {
  const article = extractArticle(html);
  const rawText = article.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (rawText.length < 100) throw new Error("Federal Reserve policy page did not contain substantive text.");
  return { rawText, publishedAt: article.publishedAt };
}
