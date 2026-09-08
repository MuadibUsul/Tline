import { ASSETS } from "../assets";
import { supportedAtomicTicker, type ParsedAtomicView } from "./atomicViews";

/**
 * Atomic views taken from the article by rule, with no model involved.
 *
 * The model-based extractor rewrote each sentence into a standalone claim, which read
 * better and cost a great deal: measured over twelve articles it proposed 10.7 views and
 * 3.5 survived validation, so two thirds of what it wrote was generated, billed and
 * discarded. It also had to be checked against the source afterwards, because a rewrite
 * can drift from what the article actually said.
 *
 * This does the opposite. A view IS a sentence from the article, quoted exactly, so the
 * question "is this faithful to the source" cannot arise — the view and its evidence are
 * the same characters. What is lost is everything that needed comprehension rather than
 * matching: the seven-way type, the 1-5 importance, and the resolution of a pronoun
 * against an earlier paragraph. Those are left explicitly unset rather than guessed at,
 * because a wrong label is worse than an absent one.
 */

const FORWARD = /\b(?:expect|expects|expected|forecast|forecasts|anticipate|anticipates|project|projects|projected|see|sees|target|targets|estimate|estimates|predict|predicts|outlook|guidance|should|will|likely|could|may|might)\b/i;
const BULL = /\b(?:bullish|upgrade[sd]?|raise[sd]?|raising|upside|outperform|overweight|rally|rebound|tailwind|beat|stronger|improve[sd]?|expansion|recovery|constructive|buy)\b/i;
const BEAR = /\b(?:bearish|downgrade[sd]?|cut[s]?|cutting|lower|downside|underperform|underweight|selloff|sell-off|headwind|glut|oversupply|weaken(?:s|ed|ing)?|deteriorat\w*|miss|recession|contraction|slowdown|reduce[sd]?)\b/i;
const NEUTRAL_WORDS = /\b(?:unchanged|neutral|hold|steady|balanced|in line|flat|stable|maintain(?:s|ed)?)\b/i;
const HEDGE = /\b(?:likely|may|could|might|unless|subject to|if|possibly|potentially|risk of)\b/i;
const CONDITIONAL = /\b(?:if|unless|provided that|should\s+\w+\s+(?:rise|fall|drop|climb)|in the event)\b/i;
const NUMBER = /(?:[$€£¥]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|bp|bps|bn|billion|million|trillion|tn|k)?/i;

/** A period the sentence names, or null when it names none. */
const HORIZONS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/\bQ([1-4])\s*(20\d{2})\b/i, (m) => `Q${m[1]} ${m[2]}`],
  [/\b(20\d{2})\s*Q([1-4])\b/i, (m) => `Q${m[2]} ${m[1]}`],
  [/\b(?:end|year-end|end of)\s*(?:of\s*)?(20\d{2})\b/i, (m) => `year-end ${m[1]}`],
  [/\b(?:H[12])\s*(20\d{2})\b/i, (m) => m[0].toUpperCase()],
  [/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i, (m) => `${m[1]} ${m[2]}`],
  [/\b(20\d{2})\b/, (m) => m[1]],
  [/\b(next|coming|this)\s+(quarter|year|month|week)\b/i, (m) => m[0].toLowerCase()],
  [/\b(short|near|medium|long)[- ]term\b/i, (m) => `${m[1].toLowerCase()}-term`],
];

/**
 * Sentence boundaries, avoiding the abbreviations that appear in this corpus.
 *
 * A split on every period cuts "U.S. GDP" in half and quotes half a sentence, which is
 * both wrong and unquotable. The list is short on purpose: these are the ones that
 * actually occur in institutional research.
 */
const ABBREVIATIONS = /\b(?:U\.S|U\.K|E\.U|No|Inc|Ltd|Corp|Co|vs|approx|est|e\.g|i\.e|Dr|Mr|Ms|Mrs|Prof|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.$/i;

export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const out: string[] = [];
  let current = "";
  for (const piece of normalized.split(/(?<=[.!?])\s+/)) {
    current = current ? `${current} ${piece}` : piece;
    // An abbreviation ended the piece, so the sentence continues into the next one.
    if (ABBREVIATIONS.test(current)) continue;
    out.push(current);
    current = "";
  }
  if (current) out.push(current);
  return out;
}

function direction(sentence: string): ParsedAtomicView["direction"] {
  if (CONDITIONAL.test(sentence)) return "conditional";
  const bull = BULL.test(sentence);
  const bear = BEAR.test(sentence);
  // Both directions in one sentence is a comparison or a two-sided risk, not a call.
  if (bull && !bear) return "bullish";
  if (bear && !bull) return "bearish";
  return "neutral";
}

function horizon(sentence: string): string {
  for (const [pattern, format] of HORIZONS) {
    const match = sentence.match(pattern);
    if (match) return format(match);
  }
  return "unspecified";
}

/**
 * Whether a sentence carries a view rather than background.
 *
 * Two signals, both required: it must look forward or take a side, and it must be about
 * something specific — a figure or a tracked instrument. Prose that only does one of the
 * two is commentary, and admitting it would bury the views in narration.
 */
/**
 * Page furniture that survived PDF extraction.
 *
 * A running header carries the publication name, a date and a page number, and once the
 * line breaks are gone it is glued to whatever sentence began that page — so it reads as
 * prose to every test above and would be published as a view. Real extraction output:
 *
 *   "Article | 7 September 2026 1 THINK Economic and financial analysis Article | …"
 *
 * The pipe is what gives it away. It separates fields in a header and effectively never
 * appears inside institutional prose, which makes it a cheap and specific signal.
 *
 * A sentence carrying both a header and a real claim is dropped rather than trimmed:
 * where the furniture ends cannot be located reliably, and publishing half a header is
 * worse than losing one view out of an article that yields several.
 */
function looksLikeFurniture(sentence: string): boolean {
  return sentence.includes("|");
}

function carriesView(sentence: string): boolean {
  const words = sentence.split(/\s+/).length;
  if (words < 8 || words > 60) return false;
  if (looksLikeFurniture(sentence)) return false;
  const stance = FORWARD.test(sentence) || BULL.test(sentence) || BEAR.test(sentence) || NEUTRAL_WORDS.test(sentence);
  if (!stance) return false;
  return NUMBER.test(sentence) || tickerIn(sentence) !== null;
}

function tickerIn(sentence: string): string | null {
  for (const asset of ASSETS) {
    if (supportedAtomicTicker(asset.ticker, sentence)) return asset.ticker;
  }
  return null;
}

/**
 * The type and importance a model used to supply.
 *
 * Left at fixed values rather than inferred: keyword rules can separate a forecast from a
 * risk only by guessing, and a view labelled "risk" that is actually a target is worse for
 * a reader than one that admits it was never classified.
 */
export const RULE_TYPE = "unclassified" as const;
const RULE_IMPORTANCE = 3;

export function extractAtomicViewsByRule(sourceText: string, limit = 12): ParsedAtomicView[] {
  const seen = new Set<string>();
  const out: ParsedAtomicView[] = [];

  for (const sentence of splitSentences(sourceText)) {
    if (out.length >= limit) break;
    if (!carriesView(sentence)) continue;
    const key = sentence.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const ticker = tickerIn(sentence);
    const asset = ticker ? ASSETS.find((item) => item.ticker === ticker)?.name ?? ticker : "General";
    out.push({
      viewEn: sentence,
      // The site is English-only and nothing renders this field. It carries the same text
      // rather than an empty string so a reader of the database is not left wondering
      // whether the row was truncated.
      viewZh: sentence,
      type: RULE_TYPE as unknown as ParsedAtomicView["type"],
      asset,
      assetTicker: ticker,
      topic: asset,
      direction: direction(sentence),
      timeHorizon: horizon(sentence),
      value: sentence.match(NUMBER)?.[0]?.trim() ?? null,
      conditionEn: null,
      conditionZh: null,
      rationaleEn: null,
      rationaleZh: null,
      // Hedged language is a weaker claim, and that much a rule can tell honestly.
      confidence: HEDGE.test(sentence) ? "low" : "medium",
      importance: RULE_IMPORTANCE,
      // The view and its evidence are the same characters, so this cannot disagree.
      sourceQuote: sentence,
    });
  }
  return out;
}
