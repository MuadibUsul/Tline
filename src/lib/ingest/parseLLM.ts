import { ASSETS, DIRECTION, type DirectionKey } from "../assets";
import { resolveLLMProvider } from "../llm/config";
import { completeJSON, type LLMProvider } from "../llm/provider";
import type { Segment } from "./extract";
import { ATOMIC_VIEW_PROMPT_VERSION, type ParsedAtomicView } from "./atomicViews";
import { validateAnalysisGrounding } from "./analysisGrounding";
import { extractAtomicViewsByRule } from "./atomicViewsRules";

export interface ParsedAsset {
  ticker: string;
  direction: number; // -2..+2
  target?: number | null;
  previousTarget?: number | null;
  timeHorizon?: string | null;
  confidence: number;
}

export interface ParsedArticle {
  /** Written for search; null when the model produced nothing usable. */
  seoTitle: string | null;
  summary: string;
  summaryZh: string | null;
  keyArguments: string[];
  keyArgumentsZh: string[];
  keyNumbers: { label: string; value: string }[];
  keyNumbersZh: { label: string; value: string }[];
  risks: string[];
  risksZh: string[];
  interpretation: string | null;
  interpretationZh: string | null;
  importanceScore: number;
  confidence: number;
  assets: ParsedAsset[];
  atomicViews: ParsedAtomicView[];
  unresolvedTickers: string[];
  needsLLM: boolean;
  provider: string;
  model: string;
  promptVersion: string;
  reviewStatus: "ok" | "needs_review";
}

export interface ParseInput {
  institution: string;
  title: string;
  text: string;
  publishedAt: string;
}

const BULL = ["bullish", "upgrade", "raise", "raised", "upside", "outperform", "overweight", "rally", "tailwind", "strong demand", "beat", "higher target", "constructive", "buy"];
const BEAR = ["bearish", "downgrade", "cut", "lower target", "downside", "underperform", "underweight", "selloff", "sell-off", "headwind", "glut", "oversupply", "weak demand", "miss", "recession", "reduce"];
const STRONG = ["strongly", "significant", "sharply", "aggressive", "conviction", "materially"];
const NEUTRAL = ["neutral", "hold", "balanced risk", "no directional view", "market weight", "equal weight"];

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// Word-boundary alias match for ASCII (so "euro" ≠ "Europe", "eth" ≠ "whether");
// CJK aliases have no word boundaries, so substring is correct there.
function aliasHit(text: string, alias: string): boolean {
  if (/[^\x00-\x7f]/.test(alias)) return text.includes(alias);
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i").test(text);
}

function aliasCount(text: string, alias: string): number {
  if (/[^\x00-\x7f]/.test(alias)) return text.split(alias).length - 1;
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "gi"));
  return m ? m.length : 0;
}

function detectDirection(text: string): { dir: number; conf: number; explicit: boolean } {
  const t = text.toLowerCase();
  const bull = BULL.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  const bear = BEAR.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  const neutral = NEUTRAL.some((w) => t.includes(w));
  const strong = STRONG.some((w) => t.includes(w));
  const net = bull - bear;
  let dir: number = DIRECTION.neutral;
  if (net > 0) dir = strong && net >= 2 ? DIRECTION.strong_bull : DIRECTION.bull;
  else if (net < 0) dir = strong && -net >= 2 ? DIRECTION.strong_bear : DIRECTION.bear;
  const conf = clamp(0.5 + Math.abs(net) * 0.12, 0.5, 0.95);
  return { dir, conf, explicit: net !== 0 || neutral };
}

/** Extract only explicit target/forecast prices; ordinary amounts and years are not targets. */
function extractTargets(text: string): { target: number | null; previous: number | null } {
  const number = "([0-9][0-9,]{1,7}(?:\\.\\d+)?)";
  const rev = text.match(new RegExp(`(?:target|forecast|price objective)[^.\\n]{0,60}?from\\s*\\$?\\s*${number}\\s*(?:to|->|→)\\s*\\$?\\s*${number}`, "i"));
  if (rev) {
    return { previous: Number(rev[1].replace(/,/g, "")), target: Number(rev[2].replace(/,/g, "")) };
  }
  const explicit = [...text.matchAll(new RegExp(`(?:target|forecast|price objective)[^.\\n]{0,60}?\\$\\s*${number}`, "gi"))]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => value >= 1 && value <= 200000);
  return { target: explicit.at(-1) ?? null, previous: null };
}

interface Candidate {
  a: (typeof ASSETS)[number];
  inTitle: boolean;
  score: number;
}

function candidatesFor(input: ParseInput): Candidate[] {
  const hay = `${input.title}\n${input.text}`;
  const low = hay.toLowerCase();
  const titleLow = input.title.toLowerCase();
  const scored = ASSETS.map((a) => {
    const inTitle = a.aliases.some((al) => aliasHit(titleLow, al));
    const mentions = a.aliases.reduce((n, al) => n + aliasCount(low, al), 0);
    return { a, inTitle, score: (inTitle ? 3 : 0) + mentions };
  }).filter((s) => s.score > 0);

  // Keep assets in the title or mentioned ≥2×; cap at the 4 strongest.
  scored.sort((x, y) => y.score - x.score);
  let kept = scored.filter((s) => s.inTitle || s.score >= 2).slice(0, 4);
  if (kept.length === 0 && scored.length) kept = [scored[0]];
  return kept;
}

function parsedAsset(candidate: Candidate, text: string, direction: ReturnType<typeof detectDirection>): ParsedAsset {
  const localEvidence = text
    .split(/\n+|(?<=[.!?])\s+/)
    .filter((part) => candidate.a.aliases.some((alias) => aliasHit(part.toLowerCase(), alias)))
    .join("\n");
  const { target, previous } = extractTargets(localEvidence);
  return {
    ticker: candidate.a.ticker,
    direction: direction.dir,
    target: candidate.a.assetClass === "commodity" || candidate.a.assetClass === "equity" ? target : null,
    previousTarget: previous,
    timeHorizon: null,
    confidence: direction.conf,
  };
}

// -------- Segment-aware deterministic parser (no API key required) --------
export function heuristicParse(input: ParseInput, segments: Segment[] = []): ParsedArticle {
  const hay = `${input.title}\n${input.text}`;
  const kept = candidatesFor(input);
  const hasHeadings = segments.some((s) => Boolean(s.heading));
  const assets: ParsedAsset[] = [];
  const unresolvedTickers: string[] = [];

  if (hasHeadings) {
    for (const candidate of kept) {
      const relevant = segments
        .map((s) => `${s.heading ?? ""}\n${s.text}`.trim())
        .filter((text) => candidate.a.aliases.some((alias) => aliasHit(text.toLowerCase(), alias)));
      const evidence = relevant.map(detectDirection).filter((d) => d.explicit);
      const signs = new Set(evidence.filter((d) => d.dir !== 0).map((d) => Math.sign(d.dir)));
      if (signs.size > 1 || evidence.length === 0) {
        unresolvedTickers.push(candidate.a.ticker);
        continue;
      }
      const chosen = evidence.reduce((best, d) => Math.abs(d.dir) > Math.abs(best.dir) ? d : best);
      assets.push(parsedAsset(candidate, relevant.join("\n\n"), chosen));
    }
  } else if (kept.length > 0) {
    const main = kept[0];
    const direction = detectDirection(hay);
    if (direction.explicit) assets.push(parsedAsset(main, hay, direction));
    else unresolvedTickers.push(main.a.ticker);
    unresolvedTickers.push(...kept.slice(1).map(({ a }) => a.ticker));
  }

  const words = input.text.split(/\s+/);
  const summary = (words.slice(0, 42).join(" ") + (words.length > 42 ? "…" : "")).trim() || input.title;
  const importance = clamp(0.35 + Math.min(input.text.length, 4000) / 8000 + assets.length * 0.05, 0, 1);
  const needsLLM = unresolvedTickers.length > 0 || assets.length === 0;
  return {
    seoTitle: null,
    summary,
    summaryZh: null,
    keyArguments: [],
    keyArgumentsZh: [],
    keyNumbers: [],
    keyNumbersZh: [],
    risks: [],
    risksZh: [],
    interpretation: null,
    interpretationZh: null,
    importanceScore: Number(importance.toFixed(2)),
    confidence: assets.length ? Math.max(...assets.map((s) => s.confidence)) : 0.5,
    assets,
    atomicViews: [],
    unresolvedTickers,
    needsLLM,
    provider: "local",
    model: "heuristic-segments-v2",
    promptVersion: "v2",
    reviewStatus: needsLLM ? "needs_review" : "ok",
  };
}

/** Backward-compatible name for callers/tests outside the ingestion pipeline. */
export const mockParse = heuristicParse;

// -------- Real LLM parser (configured provider) --------
// Atomic views are no longer requested. They were the bulk of what this call produced —
// up to fifteen objects of seven bilingual fields each, of which two thirds were then
// discarded by validation — and they are now quoted from the article by rule instead.
const SYSTEM = `You extract structured investment signals from a public institutional research article.
Also write seo_title_en: a title for search engines, not a headline.
- 50-60 characters. Google truncates past that, and a cut title loses its ending.
- Lead with the specific subject a person would type: the asset, indicator, country or policy.
- Include the concrete call or figure when the report makes one.
- No institution name, no series name, no date, no pipes or brackets, no clickbait.
- Plain descriptive English. It must be true to the report; never overstate a hedged claim.
Example of a bad publisher title: "The Commodities Feed". Good seo_title_en for the same
report: "Brent Crude Holds Near $98 as Hormuz Tanker Attacks Persist".
Return ONLY valid JSON matching this shape:
{"seo_title_en":string,"summary_en":string,"summary_zh":string,"key_arguments_en":string[],"key_arguments_zh":string[],"key_numbers_en":[{"label":string,"value":string}],"key_numbers_zh":[{"label":string,"value":string}],"risks_en":string[],"risks_zh":string[],
"interpretation_en":string,"interpretation_zh":string,"importance_score":number(0..1),"confidence":number(0..1),
"assets":[{"ticker":string,"direction":"strong_bull"|"bull"|"neutral"|"bear"|"strong_bear","target":number|null,"previous_target":number|null,"time_horizon":string|null,"confidence":number(0..1)}]}
Use tickers only from this list where applicable: ${ASSETS.map((a) => a.ticker).join(", ")}.
English analysis fields must contain professional English; _zh fields must contain institution-grade Simplified Chinese preserving every number, unit and modality. Summaries must be your own words, never a verbatim copy. If unsure about an asset, omit it.`;

/** Field-by-field shape of one model-proposed asset call, before validation. */
interface RawAssetCall {
  ticker?: unknown;
  direction?: unknown;
  target?: unknown;
  previous_target?: unknown;
  time_horizon?: unknown;
  confidence?: unknown;
}

export function coerceModelResponse(input: unknown, provider: string, model: string, sourceText: string): ParsedArticle | null {
  if (!input || typeof input !== "object") return null;
  const json = input as Record<string, unknown>;
  const dirMap: Record<string, number> = {
    strong_bull: 2, bull: 1, neutral: 0, bear: -1, strong_bear: -2,
  };
  const tickers = new Set(ASSETS.map((a) => a.ticker));
  const assets: ParsedAsset[] = Array.isArray(json.assets)
    ? (json.assets as RawAssetCall[])
        .filter((a) => typeof a?.ticker === "string" && tickers.has(a.ticker)
          && typeof a?.direction === "string" && a.direction in dirMap)
        .map((a) => ({
          ticker: a.ticker as string,
          direction: dirMap[a.direction as DirectionKey],
          target: typeof a.target === "number" ? a.target : null,
          previousTarget: typeof a.previous_target === "number" ? a.previous_target : null,
          timeHorizon: typeof a.time_horizon === "string" ? a.time_horizon : null,
          confidence: clamp(Number(a.confidence) || 0.6, 0, 1),
        }))
    : [];
  const summary = typeof json.summary_en === "string" ? json.summary_en : json.summary;
  const summaryZh = typeof json.summary_zh === "string" ? json.summary_zh.trim() : null;
  // A syntactically valid JSON object is not necessarily an analysis. Provider glitches
  // have returned only the institution name; rejecting these here lets realParse retry
  // instead of publishing a one-word conclusion beside a complete article.
  if (typeof summary !== "string" || summary.trim().length < 40 || !summaryZh || summaryZh.length < 12) return null;
  const atomicViews: ParsedAtomicView[] = [];
  // Trimmed to what a search result can show; a title cut mid-word by the engine reads
  // worse than one that ends deliberately.
  const seoTitleRaw = typeof json.seo_title_en === "string" ? json.seo_title_en.trim() : "";
  const seoTitle = seoTitleRaw.length >= 15 && seoTitleRaw.length <= 90 ? seoTitleRaw : null;
  const fields = {
    seoTitle,
    summary,
    summaryZh,
    keyArguments: Array.isArray(json.key_arguments_en) ? json.key_arguments_en.slice(0, 8) : Array.isArray(json.key_arguments) ? json.key_arguments.slice(0, 8) : [],
    keyArgumentsZh: Array.isArray(json.key_arguments_zh) ? json.key_arguments_zh.slice(0, 8) : [],
    keyNumbers: Array.isArray(json.key_numbers_en) ? json.key_numbers_en.slice(0, 8) : Array.isArray(json.key_numbers) ? json.key_numbers.slice(0, 8) : [],
    keyNumbersZh: Array.isArray(json.key_numbers_zh) ? json.key_numbers_zh.slice(0, 8) : [],
    risks: Array.isArray(json.risks_en) ? json.risks_en.slice(0, 8) : Array.isArray(json.risks) ? json.risks.slice(0, 8) : [],
    risksZh: Array.isArray(json.risks_zh) ? json.risks_zh.slice(0, 8) : [],
    interpretation: typeof json.interpretation_en === "string" ? json.interpretation_en : typeof json.interpretation === "string" ? json.interpretation : null,
    interpretationZh: typeof json.interpretation_zh === "string" ? json.interpretation_zh : null,
  };

  // Atomic views prove themselves against their own quote. The free-text fields have no
  // quote, so they are checked against the article body: an analysis that asserts a figure,
  // an institution or a certainty the article never contains is marked for review. This
  // flags, it does not withhold — publication still turns on source text and PDF readiness.
  const grounding = validateAnalysisGrounding(fields, sourceText);

  return {
    ...fields,
    importanceScore: clamp(Number(json.importance_score) || 0.5, 0, 1),
    confidence: clamp(Number(json.confidence) || 0.6, 0, 1),
    assets,
    atomicViews,
    unresolvedTickers: [],
    needsLLM: false,
    provider,
    model,
    promptVersion: ATOMIC_VIEW_PROMPT_VERSION,
    reviewStatus: grounding.passed ? "ok" : "needs_review",
  };
}

async function realParse(input: ParseInput, provider: LLMProvider): Promise<ParsedArticle | null> {
  const sourceText = input.text.slice(0, 50000);
  const user = `INSTITUTION: ${input.institution}\nPUBLISHED: ${input.publishedAt}\nTITLE: ${input.title}\n\nARTICLE:\n${sourceText}`;
  let best: ParsedArticle | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await completeJSON<unknown>(provider, {
        system: SYSTEM,
        user,
        // Measured, not guessed: at 5000 the first attempt came back finish_reason
        // "length" — cut off mid-answer, so its atomic views were incomplete, so
        // reviewStatus was never "ok", so the loop below paid for a second full attempt.
        // A complete answer measures around 4,200 tokens, which left no headroom at all.
        // Output is billed on what is generated rather than on the ceiling, so raising it
        // costs nothing when the model stops on its own and saves the entire retry when
        // it would otherwise have been truncated.
        maxTokens: 8000,
      });
      const parsed = coerceModelResponse(result.value, result.meta.provider, result.meta.model, sourceText);
      if (parsed?.reviewStatus === "ok") return parsed;
      // A grounded summary without any validated atomic views is still incomplete. Retry
      // it in the same run; if both attempts are partial, retain the richer candidate so
      // the review queue has useful output rather than an empty page.
      if (parsed && (!best || parsed.atomicViews.length > best.atomicViews.length)) best = parsed;
    } catch {
      // Fall through to retry, then preserve the safe heuristic result.
    }
  }
  return best;
}

/** Use the configured model for evidence-backed atomic views; fall back safely to heuristics. */
export async function parseArticle(input: ParseInput, segments: Segment[] = []): Promise<ParsedArticle> {
  const heuristic = heuristicParse(input, segments);
  // Views are quoted from the article by rule, not written by a model. Attached to
  // whichever analysis is returned below, so they survive a model failure and cost
  // nothing when the model is switched off entirely.
  const ruleViews = extractAtomicViewsByRule(input.text);
  const provider = await resolveLLMProvider("analysis");
  if (provider) {
    const real = await realParse(input, provider);
    if (real) return { ...real, atomicViews: ruleViews };
    heuristic.reviewStatus = "needs_review";
    heuristic.model = "heuristic-fallback";
  }
  heuristic.atomicViews = ruleViews;
  // Views no longer depend on the model, so their absence is no longer what makes an
  // analysis incomplete: the grounding of the summary is.
  if (ruleViews.length > 0 && heuristic.reviewStatus !== "needs_review") heuristic.reviewStatus = "ok";
  return heuristic;
}
