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

function multiset(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function numberTokens(text: string): string[] {
  return (text.match(/(?:[$€£¥]\s*)?[+-]?\d[\d,]*(?:\.\d+)?(?:\s?%|\s?(?:bp|bps|basis points?|个?基点))?/gi) ?? [])
    .map((token) => token.toLowerCase().replace(/\s+/g, "").replace(/,/g, "").replace(/basispoints?|个?基点/g, "bps").replace(/bp$/, "bps"));
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

  const sourceNumbers = multiset(numberTokens(source));
  const translatedNumbers = multiset(numberTokens(translated));
  for (const [token, count] of sourceNumbers) {
    const actual = translatedNumbers.get(token) ?? 0;
    if (actual < count) issues.push({ code: "number_missing", message: "Missing numeric token " + token + " (" + actual + "/" + count + ")." });
  }
  for (const [token, count] of translatedNumbers) {
    const expected = sourceNumbers.get(token) ?? 0;
    if (count > expected) issues.push({ code: "number_added", message: "Unexpected numeric token " + token + " (" + count + "/" + expected + ")." });
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
