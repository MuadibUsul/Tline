import { ASSETS, DIRECTION, type DirectionKey } from "../assets";
import { completeJSON, getLLMProvider, type LLMProvider } from "../llm/provider";
import type { Segment } from "./extract";

export interface ParsedAsset {
  ticker: string;
  direction: number; // -2..+2
  target?: number | null;
  previousTarget?: number | null;
  timeHorizon?: string | null;
  confidence: number;
}

export interface ParsedArticle {
  summary: string;
  keyArguments: string[];
  keyNumbers: { label: string; value: string }[];
  risks: string[];
  interpretation: string | null;
  importanceScore: number;
  confidence: number;
  assets: ParsedAsset[];
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
  const { target, previous } = extractTargets(text);
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
    summary,
    keyArguments: [],
    keyNumbers: [],
    risks: [],
    interpretation: null,
    importanceScore: Number(importance.toFixed(2)),
    confidence: assets.length ? Math.max(...assets.map((s) => s.confidence)) : 0.5,
    assets,
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

// -------- Real LLM parser (Anthropic) --------
const SYSTEM = `You extract structured investment signals from a public institutional research article.
Return ONLY valid JSON matching this shape:
{"summary":string,"key_arguments":string[],"key_numbers":[{"label":string,"value":string}],"risks":string[],
"interpretation":string,"importance_score":number(0..1),"confidence":number(0..1),
"assets":[{"ticker":string,"direction":"strong_bull"|"bull"|"neutral"|"bear"|"strong_bear","target":number|null,"previous_target":number|null,"time_horizon":string|null,"confidence":number(0..1)}]}
Use tickers only from this list where applicable: ${ASSETS.map((a) => a.ticker).join(", ")}.
Summary must be your own words, never a verbatim copy. If unsure about an asset, omit it.`;

function coerce(json: any, provider: string, model: string): ParsedArticle | null {
  if (!json || typeof json !== "object") return null;
  const dirMap: Record<string, number> = {
    strong_bull: 2, bull: 1, neutral: 0, bear: -1, strong_bear: -2,
  };
  const tickers = new Set(ASSETS.map((a) => a.ticker));
  const assets: ParsedAsset[] = Array.isArray(json.assets)
    ? json.assets
        .filter((a: any) => tickers.has(a?.ticker) && a?.direction in dirMap)
        .map((a: any) => ({
          ticker: a.ticker,
          direction: dirMap[a.direction as DirectionKey],
          target: typeof a.target === "number" ? a.target : null,
          previousTarget: typeof a.previous_target === "number" ? a.previous_target : null,
          timeHorizon: a.time_horizon ?? null,
          confidence: clamp(Number(a.confidence) || 0.6, 0, 1),
        }))
    : [];
  if (typeof json.summary !== "string" || !json.summary) return null;
  return {
    summary: json.summary,
    keyArguments: Array.isArray(json.key_arguments) ? json.key_arguments.slice(0, 8) : [],
    keyNumbers: Array.isArray(json.key_numbers) ? json.key_numbers.slice(0, 8) : [],
    risks: Array.isArray(json.risks) ? json.risks.slice(0, 8) : [],
    interpretation: typeof json.interpretation === "string" ? json.interpretation : null,
    importanceScore: clamp(Number(json.importance_score) || 0.5, 0, 1),
    confidence: clamp(Number(json.confidence) || 0.6, 0, 1),
    assets,
    unresolvedTickers: [],
    needsLLM: false,
    provider,
    model,
    promptVersion: "v2",
    reviewStatus: "ok",
  };
}

async function realParse(input: ParseInput, provider: LLMProvider): Promise<ParsedArticle | null> {
  const user = `INSTITUTION: ${input.institution}\nPUBLISHED: ${input.publishedAt}\nTITLE: ${input.title}\n\nARTICLE:\n${input.text.slice(0, 12000)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await completeJSON<unknown>(provider, {
        system: SYSTEM,
        user,
        maxTokens: 1500,
      });
      const parsed = coerce(result.value, result.meta.provider, result.meta.model);
      if (parsed) return parsed;
    } catch {
      // Fall through to retry, then preserve the safe heuristic result.
    }
  }
  return null;
}

/** Parse heuristically first; spend an LLM call only on unresolved assets. */
export async function parseArticle(input: ParseInput, segments: Segment[] = []): Promise<ParsedArticle> {
  const heuristic = heuristicParse(input, segments);
  const provider = getLLMProvider();
  if (provider && heuristic.needsLLM) {
    const real = await realParse(input, provider);
    if (real) return real;
    heuristic.reviewStatus = "needs_review";
    heuristic.model = "heuristic-fallback";
  }
  return heuristic;
}
