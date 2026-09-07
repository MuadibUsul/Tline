import { ASSETS } from "../assets";

export interface TranslationIssue {
  code: "empty" | "number_missing" | "number_added" | "ticker_missing" | "structure";
  message: string;
}

export interface TranslationQuality {
  passed: boolean;
  score: number;
  issues: TranslationIssue[];
}

/**
 * Dates are removed from BOTH sides before tokenizing. A date is not a claim about a
 * figure, and the two languages write it so differently — "25 August 2026" against
 * "2026年8月25日" — that leaving it in produces a missing figure on one side and an
 * invented one on the other for every date in the document.
 */
const DATE_SHAPES = [
  /\d{4}-\d{1,2}-\d{1,2}/g,
  /\d{1,2}[./]\d{1,2}[./]\d{2,4}/g,
  /\d{4}\/\d{1,2}\/\d{1,2}/g,
];

// Both sides must agree on notation, or a figure present in both looks like one that was
// dropped and a second one invented. "2.7 per cent" and "2.7%" are the same claim.
const PERCENT_WORDS = /percentage\s?points?|per\s?cent(?:age)?|percent|pct|百分点/gi;
const BPS_WORDS = /basis\s?points?|bps?\b|个?基点/gi;

/**
 * Figures as unsigned magnitudes.
 *
 * The currency prefix, the sign and the unit are all dropped. Chinese renders "$4,900" as
 * "4,900 美元" and "fell 1.9%" as "-1.9%"; keeping those decorations in the token made
 * faithful translations look unfaithful. What has to survive translation is the number.
 */
function numberTokens(text: string): string[] {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  // Full dates go first, so a complete date is removed rather than half-rewritten into a
  // month name; the month mapping then only has to handle bare month references.
  const withoutDates = DATE_SHAPES.reduce((value, shape) => value.replace(shape, " "), text);
  const normalized = withoutDates
    .replace(/(?<!\d)(1[0-2]|0?[1-9])\s*月/g, (_, month: string) => months[Number(month) - 1])
    .replace(PERCENT_WORDS, "%")
    .replace(BPS_WORDS, "bps");
  return (normalized.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((token) => {
      const value = Number(token.replace(/,/g, ""));
      // Canonical numeric form, so "3.00" and "3" are one figure rather than two.
      return Number.isFinite(value) ? String(value) : token;
    })
    // Bare years are dropped. English leaves "2026" standing where Chinese writes "2026年"
    // and vice versa, and a year is a timestamp rather than a figure the translation asserts.
    .filter((token) => !/^(?:19|20|21)\d\d$/.test(token));
}

/**
 * Chinese finance prose regroups large numbers onto 万 (1e4) and 亿 (1e8): "$900bn" becomes
 * "9000亿美元". The digits legitimately differ, so a figure is accepted when the source
 * carries it at any of those scales.
 */
function scaleVariants(token: string): string[] {
  const value = Number(token);
  if (!Number.isFinite(value) || value === 0) return [token];
  return [value, value * 1e4, value / 1e4, value * 1e8, value / 1e8].map(String);
}

function tickerTokens(text: string): string[] {
  return ASSETS
    .map((asset) => asset.ticker)
    .filter((ticker) => {
      const escaped = ticker.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      return new RegExp("(?:^|[^A-Z0-9])" + escaped + "(?:[^A-Z0-9]|$)").test(text);
    });
}

export function validateTranslation(
  source: string,
  translated: string,
  sourceSegmentCount?: number,
  translatedSegmentCount?: number,
): TranslationQuality {
  const issues: TranslationIssue[] = [];
  if (!translated.trim()) issues.push({ code: "empty", message: "Translation is empty." });

  // Presence, not repetition count. A source that says "2026" thirty-six times and a
  // translation that says it thirty-two is not dropping a figure — Chinese carries the
  // year forward implicitly. Counting occurrences scored faithful translations near zero.
  const sourceNumbers = new Set(numberTokens(source));
  const translatedNumbers = new Set(numberTokens(translated));
  for (const token of sourceNumbers) {
    if (!scaleVariants(token).some((variant) => translatedNumbers.has(variant))) {
      issues.push({ code: "number_missing", message: "Missing numeric token " + token + "." });
    }
  }
  for (const token of translatedNumbers) {
    if (!scaleVariants(token).some((variant) => sourceNumbers.has(variant))) {
      issues.push({ code: "number_added", message: "Unexpected numeric token " + token + "." });
    }
  }

  const translatedTickers = tickerTokens(translated);
  for (const ticker of tickerTokens(source)) {
    if (!translatedTickers.includes(ticker)) {
      issues.push({ code: "ticker_missing", message: "Missing ticker " + ticker + "." });
    }
  }

  if (sourceSegmentCount !== undefined && translatedSegmentCount !== undefined && sourceSegmentCount !== translatedSegmentCount) {
    issues.push({
      code: "structure",
      message: "Segment count changed from " + sourceSegmentCount + " to " + translatedSegmentCount + ".",
    });
  }

  const score = Math.max(0, 1 - issues.length * 0.12);
  return { passed: issues.length === 0, score: Number(score.toFixed(2)), issues };
}


/**
 * Cheap structural signals for "did this translation go badly wrong", used to decide
 * whether the paid independent review is worth running.
 *
 * validateTranslation checks figures, tickers and segment counts. It cannot see a chunk
 * that came back untranslated, or one where the model summarised instead of translating —
 * both of which change the SHAPE of the output, which is measurable for free.
 *
 * Thresholds are taken from the 340 translations already in the corpus rather than guessed.
 * Among those the reviewer passed, Chinese characters per English source word sits between
 * 1.31 (p1) and 1.89 (p99), and the Latin-script share of the output stays under 0.31 (p99).
 * The bands below sit just outside that, so ordinary output is never flagged and only a
 * genuinely misshapen result is.
 */
export interface TranslationRisk {
  risky: boolean;
  reasons: string[];
  charsPerWord: number;
  latinShare: number;
}

const CHARS_PER_WORD_MIN = 1.15;
const CHARS_PER_WORD_MAX = 2.15;
const LATIN_SHARE_MAX = 0.35;
// Below this the ratios are dominated by a handful of tokens and say nothing useful.
const MIN_SOURCE_WORDS = 50;

export function assessTranslationRisk(source: string, translated: string): TranslationRisk {
  const sourceWords = (source.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length;
  const chineseChars = (translated.match(/[一-鿿]/g) ?? []).length;
  // Runs of two or more letters: an isolated capital is a ticker or an initial, whereas
  // untranslated prose shows up as words.
  const latinChars = (translated.match(/[A-Za-z]{2,}/g) ?? []).join("").length;
  const charsPerWord = sourceWords ? chineseChars / sourceWords : 0;
  const latinShare = translated.length ? latinChars / translated.length : 0;

  const reasons: string[] = [];
  if (sourceWords >= MIN_SOURCE_WORDS) {
    if (charsPerWord < CHARS_PER_WORD_MIN) reasons.push("Output is far shorter than the source implies; content may have been dropped.");
    if (charsPerWord > CHARS_PER_WORD_MAX) reasons.push("Output is far longer than the source implies; content may have been added.");
    if (latinShare > LATIN_SHARE_MAX) reasons.push("A large share of the output is still Latin script; part of it may be untranslated.");
  }
  return { risky: reasons.length > 0, reasons, charsPerWord: Number(charsPerWord.toFixed(3)), latinShare: Number(latinShare.toFixed(3)) };
}
