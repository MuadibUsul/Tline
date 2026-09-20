import { ASSETS, DIRECTION, type DirectionKey } from "../assets";
import { resolveLLMProvider } from "../llm/config";
import { completeJSON, type LLMProvider } from "../llm/provider";
import type { Segment } from "./extract";
import type { ParsedAtomicView } from "./atomicViews";
import { validateAnalysisGrounding } from "./analysisGrounding";
import { extractAtomicViewsByRule, splitSentences } from "./atomicViewsRules";
import { buildTaskContext, CONTEXT_BUILDER_VERSION, estimateTokens } from "../llm/context-builder";
import { decideAiExecution, recordAiExecutionEvent } from "../llm/execution-policy";
import { createHash } from "node:crypto";
import { runRoutingShadow } from "../decision/routing";

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
  contentId?: string;
  contentHash?: string;
  institution: string;
  title: string;
  text: string;
  publishedAt: string;
  classification?: {
    jurisdictionState: string;
    jurisdictions: string[];
    institutions: string[];
    topics: string[];
    assets: string[];
    assetClasses: string[];
    events: string[];
    contentType: string;
  } | null;
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
const SYSTEM = `You finish a code-prepared evidence brief from a public institutional research article.
Use only the supplied evidence. Preserve conditions, uncertainty and opposing scenarios. Never fill gaps from general knowledge.
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
English analysis fields must contain professional English; _zh fields must contain institution-grade Simplified Chinese preserving every number, unit and modality. Summaries must be your own words, never a verbatim copy. If unsure about an asset, omit it.
Keep the output compact: summaries and interpretations at most 90 English words / 160 Chinese characters each; at most 4 key arguments, 5 key numbers and 3 risks per language. Do not repeat the same point across fields.`;

/**
 * The version stamped on every analysis row.
 *
 * Exported because it is also the only way to find the rows an older prompt wrote: the
 * column was written from the first release and read by nothing, so a prompt improvement
 * reached only the articles ingested after it shipped. `seo_title_en` was asked for by this
 * version and was present on none of the corpus while it ran.
 */
export const ANALYSIS_PROMPT_VERSION = "analysis-evidence-v1";
const EVIDENCE_LIMIT = 8_000;
const EVIDENCE_SIGNAL = /\b(?:expect|forecast|target|outlook|scenario|risk|unless|if|because|therefore|however|but|versus|vs\.?|increase|decrease|rise|fall|growth|inflation|rate|yield|price|demand|supply|earnings|revenue|margin|policy)\b/i;
const EVIDENCE_NUMBER = /(?:[$€£¥]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|bp|bps|bn|billion|million|trillion|tn|k)?/i;

/** Shrink a long report to ordered source sentences that preserve facts, calls and caveats. */
export function selectAnalysisEvidence(input: ParseInput, maxChars = EVIDENCE_LIMIT): string {
  const source = input.text.replace(/\s+/g, " ").trim();
  if (source.length <= maxChars) return source;
  const sentences = splitSentences(source);
  const titleTerms = input.title.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)?.filter((word) => !/^(with|from|this|that|market|research|report|weekly|monthly)$/.test(word)) ?? [];
  const scored = sentences.map((sentence, index) => {
    const lower = sentence.toLowerCase();
    const titleHits = titleTerms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    const edge = index < 6 ? 8 - index : index >= sentences.length - 4 ? 4 : 0;
    const score = edge + Math.min(6, titleHits * 2) + (EVIDENCE_SIGNAL.test(sentence) ? 4 : 0) + (EVIDENCE_NUMBER.test(sentence) ? 3 : 0);
    return { index, sentence: sentence.slice(0, 1_500), score };
  });
  const chosen: typeof scored = [];
  let length = 0;
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (item.score === 0 || length + item.sentence.length + 16 > maxChars) continue;
    chosen.push(item);
    length += item.sentence.length + 16;
  }
  return chosen
    .sort((a, b) => a.index - b.index)
    .map((item) => `[E${String(item.index + 1).padStart(4, "0")}] ${item.sentence}`)
    .join("\n");
}

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
    keyArguments: Array.isArray(json.key_arguments_en) ? json.key_arguments_en.slice(0, 4) : Array.isArray(json.key_arguments) ? json.key_arguments.slice(0, 4) : [],
    keyArgumentsZh: Array.isArray(json.key_arguments_zh) ? json.key_arguments_zh.slice(0, 4) : [],
    keyNumbers: Array.isArray(json.key_numbers_en) ? json.key_numbers_en.slice(0, 5) : Array.isArray(json.key_numbers) ? json.key_numbers.slice(0, 5) : [],
    keyNumbersZh: Array.isArray(json.key_numbers_zh) ? json.key_numbers_zh.slice(0, 5) : [],
    risks: Array.isArray(json.risks_en) ? json.risks_en.slice(0, 3) : Array.isArray(json.risks) ? json.risks.slice(0, 3) : [],
    risksZh: Array.isArray(json.risks_zh) ? json.risks_zh.slice(0, 3) : [],
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
    promptVersion: ANALYSIS_PROMPT_VERSION,
    reviewStatus: grounding.passed ? "ok" : "needs_review",
  };
}

async function realParse(input: ParseInput, provider: LLMProvider, segments: Segment[]): Promise<ParsedArticle | null> {
  const sourceText = input.text;
  const built = buildTaskContext("analysis", { title: input.title, text: sourceText, sections: segments });
  const evidence = built.strategy === "FULL" ? sourceText : selectAnalysisEvidence({ ...input, text: built.selectedText });
  const contexts = evidence === sourceText ? [sourceText] : [evidence, sourceText];
  const evidenceTokens = estimateTokens(evidence);
  const evidenceStrategy = evidence === sourceText ? "FULL" : built.strategy === "FULL" ? "SELECTIVE" : built.strategy;
  const policy = decideAiExecution({
    taskType: "analysis",
    contentId: input.contentId,
    contentHash: input.contentHash ?? createHash("sha256").update(sourceText).digest("hex"),
    promptVersion: ANALYSIS_PROMPT_VERSION,
    contextBuilderVersion: CONTEXT_BUILDER_VERSION,
    requestedOutput: "analysis",
    route: { provider: provider.name, model: provider.model },
  });
  await runRoutingShadow({
    task: "analysis",
    contentId: input.contentId,
    title: input.title,
    excerpt: evidence,
    structuredMetadata: { institution: input.institution, publishedAt: input.publishedAt },
    policy,
  });
  let best: ParsedArticle | null = null;
  for (const context of contexts) {
    try {
      const result = await completeJSON<unknown>(provider, {
        system: SYSTEM,
        user: `PUBLISHER: ${input.institution}\nPUBLISHED: ${input.publishedAt}\nTITLE: ${input.title}\nSTRUCTURED FACETS (already classified; do not re-derive): ${JSON.stringify(input.classification ?? {})}\n\n${context === evidence && evidence !== sourceText ? "CODE-SELECTED EVIDENCE" : "ARTICLE"}:\n${context}`,
        maxTokens: 3_200,
        audit: {
          contentId: input.contentId,
          requestFingerprint: policy.fingerprint,
          promptVersion: ANALYSIS_PROMPT_VERSION,
          executionLevel: context === sourceText ? "LEVEL_3" : policy.executionLevel,
          contextStrategy: context === sourceText ? "FULL" : evidenceStrategy,
          cacheStatus: "MISS",
          reasonCodes: context === sourceText && evidence !== sourceText ? ["LOW_CONFIDENCE_ESCALATION"] : policy.reasonCodes,
          savingsAttribution: context === sourceText ? undefined : "CONTEXT_REDUCTION",
          originalEstimatedTokens: built.originalEstimatedTokens,
          optimizedEstimatedTokens: context === sourceText ? built.originalEstimatedTokens : evidenceTokens,
        },
      }, 1);
      const fullFallback = context === sourceText;
      await recordAiExecutionEvent({
        task: "analysis", contentId: input.contentId,
        policy: {
          ...policy,
          executionLevel: fullFallback ? "LEVEL_3" : policy.executionLevel,
          contextStrategy: fullFallback ? "FULL" : evidenceStrategy,
          reasonCodes: fullFallback && evidence !== sourceText ? ["LOW_CONFIDENCE_ESCALATION"] : policy.reasonCodes,
        },
        cacheStatus: "MISS",
        attribution: fullFallback ? undefined : "CONTEXT_REDUCTION",
        originalEstimatedTokens: built.originalEstimatedTokens,
        optimizedEstimatedTokens: fullFallback ? built.originalEstimatedTokens : evidenceTokens,
        actualInputTokens: result.meta.usage?.inputTokens,
      });
      const parsed = coerceModelResponse(result.value, result.meta.provider, result.meta.model, sourceText);
      if (parsed?.reviewStatus === "ok") return parsed;
      if (parsed) best = parsed;
    } catch (error) {
      // A larger context can repair incomplete JSON/content, but never an auth, balance,
      // rate-limit or network failure. Let article backoff handle provider failures.
      if (!String(error).includes("did not return a valid JSON object")) throw error;
    }
  }
  return best;
}

/** Use the configured model to finish the code-selected brief; fall back safely to heuristics. */
export async function parseArticle(input: ParseInput, segments: Segment[] = []): Promise<ParsedArticle> {
  const heuristic = heuristicParse(input, segments);
  // Views are quoted from the article by rule, not written by a model. Attached to
  // whichever analysis is returned below, so they survive a model failure and cost
  // nothing when the model is switched off entirely.
  const ruleViews = extractAtomicViewsByRule(input.text);
  const provider = await resolveLLMProvider("analysis");
  if (provider) {
    const real = await realParse(input, provider, segments);
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
