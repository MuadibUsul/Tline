/**
 * Whether a stored atomic view reads as a usable market observation.
 *
 * Extraction sometimes yields fragments of the source layout rather than a claim: table
 * header rows ("销售与新增挂牌量比率（%；季调）单位销量（%）…"), chart axis sequences
 * ("-30 -20 -10 0 10 20"), or text cut mid-name. Those are not opinions, and a hub that
 * shows them reads as a data dump (the owner said so on 2026-10-17). Two consumers:
 *
 *  - the homepage's observation block filters them out before display;
 *  - `scripts/rewrite-views.ts` finds them (and their siblings) and has a model rewrite
 *    each into one complete, self-contained view, anchored to the stored source quote.
 */
export interface ViewLike {
  viewEn: string;
  viewZh?: string | null;
  sourceQuote?: string | null;
}

const AXIS_RUN = /(?:^|\s)[-−]?\d+(?:[.,]\d+)?(?:\s+[-−]?\d+(?:[.,]\d+)?){3,}/;
const BRACKET_LABELS = /（[^）]{0,8}）/g;

/**
 * A fragment, judged from its text alone. Deliberately conservative: a real sentence that
 * carries several figures must pass, so only layout-shaped signals fire — a run of bare
 * numbers (chart axes), several bracketed column labels in a row (table headers), a body
 * that is mostly digits, or a short Chinese clause that simply stops mid-thought.
 */
export function looksLikeViewFragment(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  // A complete view can be short ("美股盈利预期仍有上修空间，维持超配。"), but a handful of
  // characters is a label, not a claim.
  if (clean.length < 12) return true;
  // Page furniture that extraction sometimes keeps: list bullets, page headers such as
  // "1 Westpac ...：", chart captions, and inline bullet markers used by some publishers.
  if (/^[•●►▪◦]\s*/.test(clean) || clean.includes("►")) return true;
  if (/^(?:图表|图|表|Figure|Table)\s*\d+/i.test(clean)) return true;
  if (/^(?:来源|Source)\s*[:：]/i.test(clean)) return true;
  if (/^\d{1,2}\s+[^│：:]{0,40}(?:│|：|:)/.test(clean)) return true;
  if (clean.includes("**") || /important disclosures/i.test(clean)) return true;
  const digits = (clean.match(/\d/g) ?? []).length;
  if (digits / clean.length > 0.35) return true;
  if (AXIS_RUN.test(clean)) return true;
  // Three or more bracketed short labels — （%）（%）（%）, （季调）（%）… — are a header row.
  if ((clean.match(BRACKET_LABELS) ?? []).length >= 3) return true;
  // A Chinese clause that ends without punctuation and is too short to be a paragraph is
  // text cut at a boundary ("潜在买家的这种观望态度预计将拖累住房需求").
  if (/[\u4e00-\u9fff]/.test(clean) && clean.length < 60 && !/[。！？…”」』）]$/.test(clean)) return true;
  return false;
}

/** The text a reader in this language would see. */
export function displayedViewText(view: ViewLike, zh: boolean): string {
  return ((zh ? view.viewZh || view.viewEn : view.viewEn || view.viewZh) ?? "").trim();
}

/** Which stored views the rewrite pass should look at (and the homepage should skip). */
export function needsViewRewrite(view: ViewLike, zh: boolean): boolean {
  return looksLikeViewFragment(displayedViewText(view, zh));
}
