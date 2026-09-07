import { ASSETS } from "../assets";

export const ATOMIC_VIEW_PROMPT_VERSION = "atomic-views-v3";

export const ATOMIC_VIEW_TYPES = ["forecast", "target", "direction", "conditional", "risk", "rationale", "market_impact"] as const;
export const ATOMIC_VIEW_DIRECTIONS = ["bullish", "bearish", "neutral", "conditional"] as const;
export const ATOMIC_VIEW_CONFIDENCE = ["high", "medium", "low"] as const;

export interface ParsedAtomicView {
  viewEn: string;
  viewZh: string;
  type: typeof ATOMIC_VIEW_TYPES[number];
  asset: string;
  assetTicker: string | null;
  topic: string;
  direction: typeof ATOMIC_VIEW_DIRECTIONS[number];
  timeHorizon: string;
  value: string | null;
  conditionEn: string | null;
  conditionZh: string | null;
  rationaleEn: string | null;
  rationaleZh: string | null;
  confidence: typeof ATOMIC_VIEW_CONFIDENCE[number];
  importance: number;
  sourceQuote: string;
}

export const ATOMIC_VIEW_INSTRUCTIONS = `
You are a professional financial-research extraction and structuring analyst. Decompose the complete report into 5-15 independent atomic views, not a summary.

Each view must be understandable on its own and contain institution + object + judgment + time horizon; include its condition when conditional. Split different assets, numbers, horizons and scenarios into separate views. Prioritize forecast, target, directional, conditional, risk, rationale and market-impact views. Preserve uncertainty words such as may/could/if; never turn a conditional statement into certainty. Keep rationale separate from conclusion and deduplicate semantically overlapping views.

For every view return a concise professional English formulation and an institutional-quality Simplified Chinese translation. Preserve all numbers, units, dates, modality and financial terminology exactly. Tag asset, optional supported ticker, topic, direction and time horizon. Importance is an integer 1-5; confidence is high, medium or low.

source_quote is mandatory and must be a direct, contiguous quotation from ARTICLE that fully supports the view. Never invent, translate or paraphrase source_quote. A view without a valid source quote must not be returned. Accuracy > information value > independence > quantity.

`;

const stringOrNull = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
/**
 * The form both sides of the quote check are compared in.
 *
 * NFKC folds width and ligatures but leaves typographic punctuation alone, and publisher
 * bodies are full of it: of forty articles sampled, thirty-five contained curly
 * apostrophes (463 of them) and nineteen contained curly double quotes (514). A model
 * copying a phrase back with a straight apostrophe then failed `includes`, and a faithful
 * quotation was discarded along with the entire view it supported — the single largest
 * rejection reason on some article sets.
 *
 * Folding is symmetric, applied to source and quote alike, and only ever used for
 * comparison: the quote stored on the view keeps the model's original characters.
 */
const TYPOGRAPHIC: Array<[RegExp, string]> = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐‑‒–—―−]/g, "-"],
  [/…/g, "..."],
  // Invisible: a soft hyphen from a PDF line break, or a zero-width joiner, is present on
  // one side of the comparison and not the other purely by accident of extraction.
  [/[­​‌‍﻿]/g, ""],
];

const normalized = (value: string) => TYPOGRAPHIC
  .reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value.normalize("NFKC"))
  .replace(/[\s ]+/g, " ")
  .trim();
const numberTokens = (value: string) => value.match(/\d+(?:[,.]\d+)*(?:%|bp|bps)?/gi)?.map((token) => token.replace(/,/g, "").toLowerCase()) ?? [];
const MODALITY = ["likely", "may", "could", "might", "unless", "subject to"];
const CLAIM_CONCEPTS: Array<[RegExp, RegExp]> = [
  [/\b(?:labor market|employment|jobs?|unemployment)\b/i, /\b(?:labor market|employment|jobs?|unemployment)\b/i],
  [/\b(?:rate hikes?|hiking rates?|raise rates?|raising rates?|tighten(?:ing)? policy)\b/i, /\b(?:rate hikes?|hiking rates?|raise rates?|raising rates?|increase rates?|tighten(?:ing)? policy)\b/i],
  [/\b(?:rate cuts?|cutting rates?|lower rates?|easing policy)\b/i, /\b(?:rate cuts?|cutting rates?|lower rates?|reducing rates?|easing policy)\b/i],
  [/\b(?:hold rates?|keep rates? unchanged|maintain rates?)\b/i, /\b(?:hold rates?|keep rates? unchanged|maintain rates?|leave rates? unchanged)\b/i],
  [/\b(?:recession|economic contraction)\b/i, /\b(?:recession|economic contraction)\b/i],
];
const BILINGUAL_CONCEPTS: Array<[RegExp, RegExp]> = [
  [/劳动力市场|就业|失业/, /\b(?:labor market|employment|jobs?|unemployment)\b/i],
  [/加息|提高利率|上调利率/, /\b(?:rate hikes?|hiking rates?|raise rates?|raising rates?|increase rates?|tighten(?:ing)? policy)\b/i],
  [/降息|降低利率|下调利率/, /\b(?:rate cuts?|cutting rates?|lower rates?|reducing rates?|easing policy)\b/i],
  [/维持利率|利率不变/, /\b(?:hold rates?|keep rates? unchanged|maintain rates?|leave rates? unchanged)\b/i],
  [/衰退|经济收缩/, /\b(?:recession|economic contraction)\b/i],
];

function preservesModality(quote: string, view: string, condition: string | null): boolean {
  const source = quote.toLocaleLowerCase();
  const output = `${view} ${condition ?? ""}`.toLocaleLowerCase();
  if (MODALITY.some((word) => source.includes(word) && !output.includes(word))) return false;
  if (/\bif\b/.test(source) && !/\bif\b/.test(output) && !condition) return false;
  return true;
}

function preservesSupportedClaims(quote: string, viewEn: string, viewZh: string): boolean {
  if (CLAIM_CONCEPTS.some(([claim, evidence]) => claim.test(viewEn) && !evidence.test(quote))) return false;
  if (BILINGUAL_CONCEPTS.some(([claim, english]) => claim.test(viewZh) && !english.test(viewEn))) return false;
  return numberTokens(viewZh).every((token) => numberTokens(quote).includes(token));
}

export function supportedAtomicTicker(ticker: string | null, evidence: string): string | null {
  if (!ticker) return null;
  const definition = ASSETS.find((asset) => asset.ticker === ticker.toUpperCase());
  if (!definition) return null;
  const text = normalized(evidence).toLocaleLowerCase();
  const aliases = definition.ticker === "FED" ? ["fed", "fomc", "federal reserve", "powell", "warsh", "美联储"] : definition.aliases;
  return aliases.some((alias) => /[^\x00-\x7f]/.test(alias)
    ? text.includes(alias.toLocaleLowerCase())
    : new RegExp(`(?:^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i").test(text)) ? definition.ticker : null;
}

/**
 * What the model offered, and what survived.
 *
 * Every rejected view was still generated, and output tokens are billed on what the model
 * writes rather than on what the caller keeps. A high rejection rate is therefore paid for
 * in full and invisible in every other measure — which is exactly the case worth knowing
 * about, because the remedy is a prompt that states these rules rather than a validator
 * that silently discards afterwards.
 */
export interface AtomicViewYield {
  views: ParsedAtomicView[];
  /** Views the model proposed, before any cap or check. */
  proposed: number;
  kept: number;
  /** Rejection reason to count; keys are only present when they occurred. */
  rejected: Record<string, number>;
}

/** Keep only evidence-backed views. Invalid enum values, invented quotes and unsupported numbers are dropped. */
export function validateAtomicViews(value: unknown, sourceText: string): ParsedAtomicView[] {
  return validateAtomicViewYield(value, sourceText).views;
}

export function validateAtomicViewYield(value: unknown, sourceText: string): AtomicViewYield {
  const rejected: Record<string, number> = {};
  const drop = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
  if (!Array.isArray(value)) return { views: [], proposed: 0, kept: 0, rejected };
  const source = normalized(sourceText);
  const tickers = new Set(ASSETS.map((asset) => asset.ticker));
  const seen = new Set<string>();
  const out: ParsedAtomicView[] = [];
  // Everything past the twentieth was generated and paid for, then never looked at.
  if (value.length > 20) rejected.over_read_cap = value.length - 20;

  for (const raw of value.slice(0, 20)) {
    if (!raw || typeof raw !== "object") { drop("not_object"); continue; }
    const item = raw as Record<string, unknown>;
    const viewEn = stringOrNull(item.view_en);
    const viewZh = stringOrNull(item.view_zh);
    const sourceQuote = stringOrNull(item.source_quote);
    const type = stringOrNull(item.type);
    const direction = stringOrNull(item.direction);
    const confidence = stringOrNull(item.confidence);
    const asset = stringOrNull(item.asset);
    const topic = stringOrNull(item.topic);
    const timeHorizon = stringOrNull(item.time_horizon);
    if (!viewEn || !viewZh || !sourceQuote || !asset || !topic || !timeHorizon) { drop("missing_field"); continue; }
    if (!ATOMIC_VIEW_TYPES.includes(type as typeof ATOMIC_VIEW_TYPES[number])) { drop("bad_type"); continue; }
    if (!ATOMIC_VIEW_DIRECTIONS.includes(direction as typeof ATOMIC_VIEW_DIRECTIONS[number])) { drop("bad_direction"); continue; }
    if (!ATOMIC_VIEW_CONFIDENCE.includes(confidence as typeof ATOMIC_VIEW_CONFIDENCE[number])) { drop("bad_confidence"); continue; }
    const quote = normalized(sourceQuote);
    if (!quote || !source.includes(quote)) { drop("quote_not_in_source"); continue; }

    const valueText = stringOrNull(item.value);
    const conditionEn = stringOrNull(item.condition_en);
    if (valueText && numberTokens(valueText).some((token) => !numberTokens(quote).includes(token))) { drop("value_number_unsupported"); continue; }
    if (numberTokens(viewEn).some((token) => !numberTokens(quote).includes(token))) { drop("view_number_unsupported"); continue; }
    if (!preservesModality(quote, viewEn, conditionEn)) { drop("modality_changed"); continue; }
    if (!preservesSupportedClaims(quote, viewEn, viewZh)) { drop("unsupported_claim"); continue; }
    const key = normalized(viewEn).toLocaleLowerCase();
    if (seen.has(key)) { drop("duplicate"); continue; }
    seen.add(key);

    const requestedTicker = stringOrNull(item.asset_ticker)?.toUpperCase() ?? null;
    out.push({
      viewEn, viewZh,
      type: type as ParsedAtomicView["type"],
      asset,
      assetTicker: requestedTicker && tickers.has(requestedTicker) ? supportedAtomicTicker(requestedTicker, `${asset} ${topic} ${viewEn} ${sourceQuote}`) : null,
      topic,
      direction: direction as ParsedAtomicView["direction"],
      timeHorizon,
      value: valueText,
      conditionEn,
      conditionZh: stringOrNull(item.condition_zh),
      rationaleEn: stringOrNull(item.rationale_en),
      rationaleZh: stringOrNull(item.rationale_zh),
      confidence: confidence as ParsedAtomicView["confidence"],
      importance: Math.max(1, Math.min(5, Math.round(Number(item.importance) || 1))),
      sourceQuote,
    });
    if (out.length === 15) break;
  }
  return { views: out, proposed: value.length, kept: out.length, rejected };
}

export const ATOMIC_VIEW_JSON_SHAPE = `"atomic_views":[{"view_en":string,"view_zh":string,"type":"forecast"|"target"|"direction"|"conditional"|"risk"|"rationale"|"market_impact","asset":string,"asset_ticker":string|null,"topic":string,"direction":"bullish"|"bearish"|"neutral"|"conditional","time_horizon":string,"value":string|null,"condition_en":string|null,"condition_zh":string|null,"rationale_en":string|null,"rationale_zh":string|null,"confidence":"high"|"medium"|"low","importance":integer(1..5),"source_quote":string}]`;
