import { ASSETS } from "../assets";

export const ATOMIC_VIEW_PROMPT_VERSION = "atomic-views-v1";

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
const normalized = (value: string) => value.normalize("NFKC").replace(/[\s\u00a0]+/g, " ").trim();
const numberTokens = (value: string) => value.match(/\d+(?:[,.]\d+)*(?:%|bp|bps)?/gi)?.map((token) => token.replace(/,/g, "").toLowerCase()) ?? [];
const MODALITY = ["likely", "may", "could", "might", "unless", "subject to"];

function preservesModality(quote: string, view: string, condition: string | null): boolean {
  const source = quote.toLocaleLowerCase();
  const output = `${view} ${condition ?? ""}`.toLocaleLowerCase();
  if (MODALITY.some((word) => source.includes(word) && !output.includes(word))) return false;
  if (/\bif\b/.test(source) && !/\bif\b/.test(output) && !condition) return false;
  return true;
}

/** Keep only evidence-backed views. Invalid enum values, invented quotes and unsupported numbers are dropped. */
export function validateAtomicViews(value: unknown, sourceText: string): ParsedAtomicView[] {
  if (!Array.isArray(value)) return [];
  const source = normalized(sourceText);
  const tickers = new Set(ASSETS.map((asset) => asset.ticker));
  const seen = new Set<string>();
  const out: ParsedAtomicView[] = [];

  for (const raw of value.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
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
    if (!viewEn || !viewZh || !sourceQuote || !asset || !topic || !timeHorizon) continue;
    if (!ATOMIC_VIEW_TYPES.includes(type as typeof ATOMIC_VIEW_TYPES[number])) continue;
    if (!ATOMIC_VIEW_DIRECTIONS.includes(direction as typeof ATOMIC_VIEW_DIRECTIONS[number])) continue;
    if (!ATOMIC_VIEW_CONFIDENCE.includes(confidence as typeof ATOMIC_VIEW_CONFIDENCE[number])) continue;
    const quote = normalized(sourceQuote);
    if (!quote || !source.includes(quote)) continue;

    const valueText = stringOrNull(item.value);
    const conditionEn = stringOrNull(item.condition_en);
    if (valueText && numberTokens(valueText).some((token) => !numberTokens(quote).includes(token))) continue;
    if (numberTokens(viewEn).some((token) => !numberTokens(quote).includes(token))) continue;
    if (!preservesModality(quote, viewEn, conditionEn)) continue;
    const key = normalized(viewEn).toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const requestedTicker = stringOrNull(item.asset_ticker)?.toUpperCase() ?? null;
    out.push({
      viewEn, viewZh,
      type: type as ParsedAtomicView["type"],
      asset,
      assetTicker: requestedTicker && tickers.has(requestedTicker) ? requestedTicker : null,
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
  return out;
}

export const ATOMIC_VIEW_JSON_SHAPE = `"atomic_views":[{"view_en":string,"view_zh":string,"type":"forecast"|"target"|"direction"|"conditional"|"risk"|"rationale"|"market_impact","asset":string,"asset_ticker":string|null,"topic":string,"direction":"bullish"|"bearish"|"neutral"|"conditional","time_horizon":string,"value":string|null,"condition_en":string|null,"condition_zh":string|null,"rationale_en":string|null,"rationale_zh":string|null,"confidence":"high"|"medium"|"low","importance":integer(1..5),"source_quote":string}]`;
