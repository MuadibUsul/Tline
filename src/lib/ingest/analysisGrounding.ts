import { ASSETS } from "../assets";
import { supportedAtomicTicker } from "./atomicViews";

/**
 * Grounding check for the free-text Analysis fields.
 *
 * Atomic views carry their own `source_quote` and are validated against it in
 * `validateAtomicViews`. The Analysis summary, arguments, numbers, risks and
 * interpretation carry no quote, so their only evidence is the article body — every
 * figure, named institution and absolute claim they assert has to be traceable to it.
 */
export type AnalysisIssueCode = "number_unsupported" | "entity_unsupported" | "certainty_upgrade";

export interface AnalysisIssue {
  code: AnalysisIssueCode;
  field: string;
  detail: string;
}

export interface AnalysisGrounding {
  passed: boolean;
  score: number;
  issues: AnalysisIssue[];
}

export interface AnalysisFields {
  summary?: string | null;
  summaryZh?: string | null;
  keyArguments?: string[];
  keyArgumentsZh?: string[];
  keyNumbers?: Array<{ label?: string; value?: string }>;
  keyNumbersZh?: Array<{ label?: string; value?: string }>;
  risks?: string[];
  risksZh?: string[];
  interpretation?: string | null;
  interpretationZh?: string | null;
}

const normalize = (value: string) => value.normalize("NFKC").replace(/[\s ]+/g, " ").trim();

// Calendar dates are removed before tokenizing: "2026-08-25" would otherwise yield the
// phantom figures "-08" and "-25" purely from its separators.
const DATE_SHAPES = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
  /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g,
  /\b\d{4}\/\d{1,2}\/\d{1,2}\b/g,
];

/**
 * Figures worth checking, as unsigned magnitudes.
 *
 * The sign is dropped deliberately. Institutions write "the Nasdaq has fallen 1.9%" while
 * the analysis renders the same fact as "-1.9%"; treating that as an invented figure
 * flagged two thirds of the corpus and buried the real hallucinations. Direction is
 * carried by the structured `direction` fields, which are validated separately.
 *
 * Also skipped: bare one-digit integers (ordinals, list counts) and bare four-digit years,
 * which are routinely reformatted between a source and a summary of it.
 */
// Every spelling a unit arrives in has to be recognised on BOTH sides. Miss one on the
// source side and its figure is silently dropped, making the analysis's copy of the same
// figure look invented — "2 per cent" in the article vs "2%" in the summary.
const PERCENT_WORDS = /percentage\s?points?|per\s?cent(?:age)?|percent|pct|百分点/gi;
const BPS_WORDS = /basis\s?points?|bps?\b|个?基点/gi;

/**
 * Scale suffixes (175k vs 175,000) are deliberately NOT expanded. Binding a suffix to the
 * figure before it needs sentence structure this regex does not have: measured against the
 * corpus, expansion mis-bound phrases like "by 2028, million" and more than doubled the
 * false-positive rate (9% -> 20%). A figure whose only difference is its scale notation is
 * left unflagged instead.
 */
function numberTokens(value: string): string[] {
  const withoutDates = DATE_SHAPES.reduce((text, shape) => text.replace(shape, " "), value);
  const unified = withoutDates.replace(PERCENT_WORDS, "%").replace(BPS_WORDS, "bps");
  const matches = unified.match(/\d[\d,]*(?:\.\d+)?\s?(?:%|bps)?/gi) ?? [];
  return matches
    .map((token) => token.toLowerCase().replace(/\s+/g, "").replace(/,/g, ""))
    .filter((token) => /\d\d|[.]|%|bps/.test(token))
    .filter((token) => !/^(?:19|20|21)\d\d$/.test(token));
}

/**
 * The bare magnitude, unit stripped. Matching happens on this rather than the full token
 * because publishers and summaries disagree on notation constantly — "2.7 per cent" vs
 * "2.7%", "25 basis points" vs "25bps". Enumerating every spelling is a losing game; the
 * question worth asking is whether the figure appears in the article at all. A swapped
 * unit on a figure that IS present is not caught here, by design.
 */
function magnitude(token: string): string {
  const bare = token.replace(/(?:%|bps)$/, "");
  const value = Number(bare);
  // Canonical numeric form, so "3.00" and "3" are the same figure rather than two.
  return Number.isFinite(value) ? String(value) : bare;
}

/** Institutions an analysis must not name unless the article actually does. */
const ENTITIES: Array<{ name: string; patterns: RegExp[] }> = [
  // Bare "Fed" is matched case-sensitively: lowercase "fed" is the verb ("fed through to
  // prices"), which is not a claim about the central bank.
  { name: "Federal Reserve", patterns: [/\b(?:federal reserve|fomc|powell)\b/i, /\bFed\b/, /美联储|联邦公开市场委员会|鲍威尔/] },
  { name: "ECB", patterns: [/\b(?:ecb|european central bank)\b/i, /欧洲央行|欧央行/] },
  { name: "Bank of England", patterns: [/\b(?:bank of england|boe)\b/i, /英国央行|英格兰银行/] },
  { name: "Bank of Japan", patterns: [/\b(?:bank of japan|boj)\b/i, /日本央行|日本银行/] },
  { name: "People's Bank of China", patterns: [/\b(?:people'?s bank of china|pboc)\b/i, /中国人民银行|中国央行/] },
  { name: "IMF", patterns: [/\b(?:imf|international monetary fund)\b/i, /国际货币基金组织/] },
  { name: "OPEC", patterns: [/\bopec\b/i, /欧佩克|石油输出国组织/] },
  { name: "World Bank", patterns: [/\bworld bank\b/i, /世界银行/] },
];

/** Unhedged claims. Present in the analysis but absent from the source, they are invented certainty. */
const CERTAINTY = [
  /\bwill (?:definitely|certainly|surely)\b/i,
  /\bis guaranteed\b/i,
  /\bwithout a doubt\b/i,
  /\bno chance\b/i,
  /\b(?:always|never) (?:leads?|results?|ends?)\b/i,
  /必将|势必|一定会|毫无疑问|必然会|肯定会/,
];

const joinNumbers = (items: AnalysisFields["keyNumbers"]) =>
  (items ?? []).map((item) => `${item?.label ?? ""} ${item?.value ?? ""}`).join(" ");

/**
 * English fields only. Figures are checked against the English article body, and Chinese
 * finance prose legitimately rescales them onto 万/亿 units — "$900bn" becomes "9000亿美元",
 * whose 9000 appears nowhere in the source. Comparing across that convention produced
 * noise, not findings. Faithfulness of the Chinese rendering is the translation
 * validator's job; this one asks whether the analysis invented anything.
 */
function numericFields(fields: AnalysisFields): Array<[string, string]> {
  return ([
    ["summary", fields.summary ?? ""],
    ["keyArguments", (fields.keyArguments ?? []).join(" ")],
    ["keyNumbers", joinNumbers(fields.keyNumbers)],
    ["risks", (fields.risks ?? []).join(" ")],
    ["interpretation", fields.interpretation ?? ""],
  ] as Array<[string, string]>).filter(([, text]) => text.trim().length > 0);
}

/** Entity and certainty claims are checked in both languages; the patterns are bilingual. */
function allFields(fields: AnalysisFields): Array<[string, string]> {
  return ([
    ...numericFields(fields),
    ["summaryZh", fields.summaryZh ?? ""],
    ["keyArgumentsZh", (fields.keyArgumentsZh ?? []).join(" ")],
    ["keyNumbersZh", joinNumbers(fields.keyNumbersZh)],
    ["risksZh", (fields.risksZh ?? []).join(" ")],
    ["interpretationZh", fields.interpretationZh ?? ""],
  ] as Array<[string, string]>).filter(([, text]) => text.trim().length > 0);
}

export function validateAnalysisGrounding(fields: AnalysisFields, sourceText: string): AnalysisGrounding {
  const source = normalize(sourceText);
  const sourceNumbers = new Set(numberTokens(source).map(magnitude));
  const sourceLower = source.toLocaleLowerCase();
  const issues: AnalysisIssue[] = [];
  const seen = new Set<string>();

  const add = (issue: AnalysisIssue) => {
    const key = `${issue.code}:${issue.field}:${issue.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  for (const [field, raw] of numericFields(fields)) {
    for (const token of numberTokens(normalize(raw))) {
      if (!sourceNumbers.has(magnitude(token))) add({ code: "number_unsupported", field, detail: token });
    }
  }

  for (const [field, raw] of allFields(fields)) {
    const text = normalize(raw);

    for (const entity of ENTITIES) {
      const claimed = entity.patterns.some((pattern) => pattern.test(text));
      if (claimed && !entity.patterns.some((pattern) => pattern.test(source))) {
        add({ code: "entity_unsupported", field, detail: entity.name });
      }
    }

    for (const pattern of CERTAINTY) {
      const match = text.match(pattern);
      if (match && !pattern.test(sourceLower) && !pattern.test(source)) {
        add({ code: "certainty_upgrade", field, detail: match[0] });
      }
    }
  }

  // An asset named in the analysis but absent from the article is the same class of
  // fabrication as an invented figure. Matching is by alias, not by literal ticker: an
  // article says "Philadelphia Semiconductor Index" where the analysis says SOX, and that
  // is correct identification rather than invention.
  const analysisText = allFields(fields).map(([, text]) => text).join(" ");
  for (const asset of ASSETS) {
    // Tickers are alphanumeric constants (WTI, SPX, US10Y), so no escaping is needed.
    const named = new RegExp(`(?:^|[^A-Z0-9])${asset.ticker}(?:[^A-Z0-9]|$)`).test(analysisText);
    if (named && !supportedAtomicTicker(asset.ticker, source)) {
      add({ code: "entity_unsupported", field: "assets", detail: asset.ticker });
    }
  }

  return {
    passed: issues.length === 0,
    score: Number(Math.max(0, 1 - issues.length * 0.15).toFixed(2)),
    issues,
  };
}
