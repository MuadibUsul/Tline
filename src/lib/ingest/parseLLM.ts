import { ASSETS, DIRECTION, type DirectionKey } from "../assets";

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
  model: string;
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

function detectDirection(text: string): { dir: number; conf: number } {
  const t = text.toLowerCase();
  const bull = BULL.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  const bear = BEAR.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  const strong = STRONG.some((w) => t.includes(w));
  const net = bull - bear;
  let dir: number = DIRECTION.neutral;
  if (net > 0) dir = strong && net >= 2 ? DIRECTION.strong_bull : DIRECTION.bull;
  else if (net < 0) dir = strong && -net >= 2 ? DIRECTION.strong_bear : DIRECTION.bear;
  const conf = clamp(0.5 + Math.abs(net) * 0.12, 0.5, 0.95);
  return { dir, conf };
}

/** Pull "$4,800" / "5,000" style targets near an asset mention (best-effort). */
function extractTargets(text: string): { target: number | null; previous: number | null } {
  const m = [...text.matchAll(/\$?\s?([0-9][0-9,]{2,7})(?:\.\d+)?/g)]
    .map((x) => Number(x[1].replace(/,/g, "")))
    .filter((n) => n >= 10 && n <= 200000);
  // Look for an explicit "X -> Y" revision.
  const rev = text.match(/\$?\s?([0-9][0-9,]{2,7})\s*(?:->|→|to|from)\s*\$?\s?([0-9][0-9,]{2,7})/i);
  if (rev) {
    return { previous: Number(rev[1].replace(/,/g, "")), target: Number(rev[2].replace(/,/g, "")) };
  }
  return { target: m.length ? m[m.length - 1] : null, previous: null };
}

// -------- Mock deterministic parser (no API key required) --------
export function mockParse(input: ParseInput): ParsedArticle {
  const hay = `${input.title}\n${input.text}`;
  const low = hay.toLowerCase();
  const titleLow = input.title.toLowerCase();

  // Score each asset by title presence + body mention frequency, so a gold
  // article that mentions "silver/oil/dollar" in passing isn't tagged with all.
  const scored = ASSETS.map((a) => {
    const inTitle = a.aliases.some((al) => aliasHit(titleLow, al));
    const mentions = a.aliases.reduce((n, al) => n + aliasCount(low, al), 0);
    return { a, inTitle, score: (inTitle ? 3 : 0) + mentions };
  }).filter((s) => s.score > 0);

  // Keep assets in the title or mentioned ≥2×; cap at the 4 strongest.
  scored.sort((x, y) => y.score - x.score);
  let kept = scored.filter((s) => s.inTitle || s.score >= 2).slice(0, 4);
  if (kept.length === 0 && scored.length) kept = [scored[0]];

  const { dir, conf } = detectDirection(hay);
  const { target, previous } = extractTargets(hay);
  const seen: ParsedAsset[] = kept.map(({ a }) => ({
    ticker: a.ticker,
    direction: dir,
    target: a.assetClass === "commodity" || a.assetClass === "equity" ? target : null,
    previousTarget: previous,
    timeHorizon: null,
    confidence: conf,
  }));
  const words = input.text.split(/\s+/);
  const summary = (words.slice(0, 42).join(" ") + (words.length > 42 ? "…" : "")).trim() || input.title;
  const importance = clamp(0.35 + Math.min(input.text.length, 4000) / 8000 + seen.length * 0.05, 0, 1);
  return {
    summary,
    keyArguments: [],
    keyNumbers: [],
    risks: [],
    interpretation: null,
    importanceScore: Number(importance.toFixed(2)),
    confidence: seen.length ? Math.max(...seen.map((s) => s.confidence)) : 0.5,
    assets: seen,
    model: "mock-rules-v1",
    reviewStatus: seen.length ? "ok" : "needs_review",
  };
}

// -------- Real LLM parser (Anthropic) --------
const SYSTEM = `You extract structured investment signals from a public institutional research article.
Return ONLY valid JSON matching this shape:
{"summary":string,"key_arguments":string[],"key_numbers":[{"label":string,"value":string}],"risks":string[],
"interpretation":string,"importance_score":number(0..1),"confidence":number(0..1),
"assets":[{"ticker":string,"direction":"strong_bull"|"bull"|"neutral"|"bear"|"strong_bear","target":number|null,"previous_target":number|null,"time_horizon":string|null,"confidence":number(0..1)}]}
Use tickers only from this list where applicable: ${ASSETS.map((a) => a.ticker).join(", ")}.
Summary must be your own words, never a verbatim copy. If unsure about an asset, omit it.`;

function coerce(json: any): ParsedArticle | null {
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
    model: process.env.LLM_MODEL || "claude-sonnet-5",
    reviewStatus: "ok",
  };
}

async function realParse(input: ParseInput): Promise<ParsedArticle | null> {
  let Anthropic: any;
  try {
    ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
  } catch {
    return null; // SDK not installed
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const user = `INSTITUTION: ${input.institution}\nPUBLISHED: ${input.publishedAt}\nTITLE: ${input.title}\n\nARTICLE:\n${input.text.slice(0, 12000)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.messages.create({
        model: process.env.LLM_MODEL || "claude-sonnet-5",
        max_tokens: 1500,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      });
      const raw = res.content?.[0]?.type === "text" ? res.content[0].text : "";
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = coerce(JSON.parse(match[0]));
        if (parsed) return parsed;
      }
    } catch (e) {
      // fall through to retry / mock
    }
  }
  return null;
}

/** Parse an article: real LLM when a key is present, else deterministic mock. */
export async function parseArticle(input: ParseInput): Promise<ParsedArticle> {
  if (process.env.ANTHROPIC_API_KEY) {
    const real = await realParse(input);
    if (real) return real;
    // real path failed validation twice -> mock + flag for review
    const fallback = mockParse(input);
    fallback.reviewStatus = "needs_review";
    fallback.model = "mock-fallback";
    return fallback;
  }
  return mockParse(input);
}
