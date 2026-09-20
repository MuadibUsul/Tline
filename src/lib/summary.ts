/**
 * The Chinese summary a page can actually show.
 *
 * `Analysis.summaryZh` is written by the analysis pass, and that pass cannot always write
 * it. When no model provider is configured, `heuristicParse` takes the first 42 words of the
 * English text as `summary` and returns `summaryZh: null` — while still reporting
 * `reviewStatus: "ok"`. Only `prisma/reparse.ts` ever writes the field; the translation
 * pipeline fills the whole Chinese body and never touches it.
 *
 * The result was a Chinese page with a complete translation, withheld from the index over a
 * sentence the English page never had either: the gate reads `summaryZh`, found it empty and
 * answered `noindex`. Measured on production, half of the Chinese pages withheld for a
 * missing summary carried 2,600–17,500 Chinese characters of finished translation.
 *
 * So the summary is derived where it is missing, by the same extractive rule the English
 * heuristic already uses — the opening of the report. It is deliberately not a model call:
 * the index gate has to be able to clear without one, and an article parsed by a model still
 * writes a real `summaryZh` that wins over this. The English page for these same articles
 * already shows the same kind of extractive lead under the same heading, so nothing is being
 * invented for Chinese that English does not already do.
 *
 * Deriving at read time rather than backfilling the column keeps a re-parse from undoing it:
 * a later heuristic pass would write `null` over any value stored on the row. One function,
 * read by the gate and by the page, cannot drift from itself.
 */

/** How much of the opening to keep when the body offers no sentence boundary to stop at. */
const LEAD_CHARS = 120;

/**
 * The opening of a Chinese body, at the first sentence boundary it can find.
 *
 * Markdown heading lines and list markers are stripped first: a translation segment often
 * opens with its own heading, and a summary that begins "完整中文译文" says nothing about the
 * report.
 */
export function derivedSummaryZh(text: string | null | undefined): string | null {
  const clean = (text ?? "")
    .replace(/^#{1,6}[^\n]*$/gm, "")
    .replace(/^[-*•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  // A complete sentence is what the heading above this text promises. Twelve characters is
  // the floor below which what matched is a fragment rather than a sentence.
  const sentence = /^(.{12,}?[。！？])/.exec(clean);
  if (sentence) return sentence[1].trim();
  return clean.length > LEAD_CHARS ? `${clean.slice(0, LEAD_CHARS).trimEnd()}…` : clean;
}

/** `summaryZh` where the analysis wrote one, and the translation's own opening where it did not. */
export function effectiveSummaryZh(input: {
  summaryZh?: string | null;
  translation?: { text?: string | null } | null;
}): string | null {
  const stored = input.summaryZh?.trim();
  if (stored) return stored;
  return derivedSummaryZh(input.translation?.text);
}
