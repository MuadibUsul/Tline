import type { AnalysisFields, AnalysisIssue } from "./analysisGrounding";
import { validateAnalysisGrounding } from "./analysisGrounding";

export type StructuredQualityIssueCode =
  | AnalysisIssue["code"]
  | "summary_copies_source_lead"
  | "boilerplate_in_analysis"
  | "forecast_target_unsupported"
  | "forecast_horizon_missing"
  | "forecast_horizon_unsupported"
  | "forecast_unit_missing"
  | "forecast_unit_unsupported"
  | "forecast_year_unsupported";

export interface StructuredQualityIssue {
  code: StructuredQualityIssueCode;
  field: string;
  detail: string;
}

export interface ForecastClaim {
  ticker: string;
  target?: number | null;
  previousTarget?: number | null;
  timeHorizon?: string | null;
}

export interface StructuredResearchQuality {
  passed: boolean;
  score: number;
  issues: StructuredQualityIssue[];
  forecasts: ForecastClaim[];
}

const normalize = (value: string) => value.normalize("NFKC").replace(/[\s\u00a0]+/g, " ").trim();
const numberText = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const BOILERPLATE = [
  /\b(?:for informational purposes only|does not constitute (?:an? )?(?:offer|advice|recommendation)|past performance (?:is )?not (?:a )?(?:guarantee|indicator)|all rights reserved)\b/i,
  /\b(?:subscribe|sign up|cookie policy|privacy policy|terms of use|advertisement|sponsored content|follow us|share this article)\b/i,
  /(?:仅供参考|不构成(?:任何)?(?:投资)?(?:建议|要约|推荐)|过往表现不代表未来|版权所有|订阅|广告|隐私政策|使用条款|关注我们|分享本文)/,
];

function firstSentence(value: string): string {
  return normalize(value).split(/(?<=[.!?。！？])\s+/, 1)[0] ?? "";
}

function isLeadCopy(summary: string, sourceText: string): boolean {
  const candidate = normalize(summary).replace(/[.…]+$/, "").toLocaleLowerCase();
  const lead = firstSentence(sourceText).replace(/[.…]+$/, "").toLocaleLowerCase();
  if (candidate.length < 40 || lead.length < 40) return false;
  return candidate === lead || (candidate.length >= 80 && (lead.startsWith(candidate) || candidate.startsWith(lead)));
}

function sourceYears(value: string): Set<string> {
  return new Set(value.match(/\b(?:19|20|21)\d{2}\b/g) ?? []);
}

function analysisEntries(fields: AnalysisFields): Array<[string, string]> {
  const numbers = (items: AnalysisFields["keyNumbers"]) => (items ?? []).map((item) => `${item.label ?? ""} ${item.value ?? ""}`).join(" ");
  return ([
    ["summary", fields.summary ?? ""],
    ["summaryZh", fields.summaryZh ?? ""],
    ["keyArguments", (fields.keyArguments ?? []).join(" ")],
    ["keyArgumentsZh", (fields.keyArgumentsZh ?? []).join(" ")],
    ["keyNumbers", numbers(fields.keyNumbers)],
    ["keyNumbersZh", numbers(fields.keyNumbersZh)],
    ["risks", (fields.risks ?? []).join(" ")],
    ["risksZh", (fields.risksZh ?? []).join(" ")],
    ["interpretation", fields.interpretation ?? ""],
    ["interpretationZh", fields.interpretationZh ?? ""],
  ] as Array<[string, string]>).filter(([, value]) => value.trim());
}

function targetContext(sourceText: string, value: number): string | null {
  const forms = [...new Set([String(value), numberText(value)])].map(escape).join("|");
  const patterns = [
    new RegExp(`(?:target|price objective|forecast)[^.!?\\n]{0,100}?(?:${forms})(?:[^.!?\\n]{0,100})`, "i"),
    new RegExp(`(?:${forms})[^.!?\\n]{0,100}?(?:target|price objective|forecast)(?:[^.!?\\n]{0,100})`, "i"),
  ];
  return patterns.map((pattern) => sourceText.match(pattern)?.[0] ?? null).find(Boolean) ?? null;
}

function horizonGrounded(horizon: string, sourceText: string): boolean {
  const value = normalize(horizon).toLocaleLowerCase();
  const source = normalize(sourceText).toLocaleLowerCase();
  if (!value || value === "unspecified") return false;
  if (source.includes(value)) return true;
  const compact = value.match(/^(\d+)\s*(?:m|month|months)$/);
  if (compact) return new RegExp(`\\b${compact[1]}[- ]?months?\\b`, "i").test(sourceText);
  const year = value.match(/(?:year-end\s*)?((?:20)\d{2})/);
  if (year) return new RegExp(`\\b(?:year[- ]end(?: of)?\\s*)?${year[1]}\\b`, "i").test(sourceText);
  return false;
}

function explicitTargetUnit(context: string): boolean {
  return /[$€£¥]|\b(?:usd|eur|gbp|jpy|cny|rmb|dollars?|euros?|pounds?|yen|yuan|per (?:share|barrel|ounce|tonne|metric ton))\b/i.test(context);
}

function supportedStoredTargetUnit(context: string): boolean {
  // ArticleAsset currently stores a number but no unit and every public target cell labels
  // that number as dollars. Until the schema carries a unit, admitting EUR/JPY/per-barrel
  // values would turn a sourced number into a false dollar claim.
  return /[$]|\b(?:usd|u\.s\. dollars?|dollars?)\b/i.test(context);
}

/**
 * Grade the fields which are eligible to reach a public research page.
 *
 * Invalid forecast values are removed rather than "repaired": a number without a source,
 * unit or horizon is missing data, not an invitation to infer one. The issues still mark the
 * proposed analysis for review, while callers can safely persist the returned forecasts.
 */
export function validateStructuredResearch(
  fields: AnalysisFields,
  sourceText: string,
  forecasts: ForecastClaim[] = [],
): StructuredResearchQuality {
  const grounding = validateAnalysisGrounding(fields, sourceText);
  const issues: StructuredQualityIssue[] = [...grounding.issues];
  const seen = new Set(issues.map((issue) => `${issue.code}:${issue.field}:${issue.detail}`));
  const add = (issue: StructuredQualityIssue) => {
    const key = `${issue.code}:${issue.field}:${issue.detail}`;
    if (!seen.has(key)) { seen.add(key); issues.push(issue); }
  };

  if (fields.summary && isLeadCopy(fields.summary, sourceText)) {
    add({ code: "summary_copies_source_lead", field: "summary", detail: firstSentence(sourceText).slice(0, 120) });
  }

  const years = sourceYears(sourceText);
  for (const [field, value] of analysisEntries(fields)) {
    const boilerplate = BOILERPLATE.find((pattern) => pattern.test(value));
    if (boilerplate) add({ code: "boilerplate_in_analysis", field, detail: value.slice(0, 120) });
    for (const year of sourceYears(value)) {
      if (!years.has(year)) add({ code: "forecast_year_unsupported", field, detail: year });
    }
  }

  const safeForecasts = forecasts.map((claim, index) => {
    let target = claim.target ?? null;
    let previousTarget = claim.previousTarget ?? null;
    let timeHorizon = claim.timeHorizon?.trim() || null;
    const field = `assets[${index}]`;
    const attemptedTarget = target !== null || previousTarget !== null;

    if (attemptedTarget && !timeHorizon) {
      add({ code: "forecast_horizon_missing", field, detail: claim.ticker });
      target = null;
      previousTarget = null;
    } else if (timeHorizon && !horizonGrounded(timeHorizon, sourceText)) {
      add({ code: "forecast_horizon_unsupported", field, detail: timeHorizon });
      timeHorizon = null;
      target = null;
      previousTarget = null;
    }

    for (const [name, value] of [["target", target], ["previousTarget", previousTarget]] as const) {
      if (value === null) continue;
      const context = targetContext(sourceText, value);
      if (!context) {
        add({ code: "forecast_target_unsupported", field: `${field}.${name}`, detail: String(value) });
        if (name === "target") target = null; else previousTarget = null;
      } else if (!explicitTargetUnit(context)) {
        add({ code: "forecast_unit_missing", field: `${field}.${name}`, detail: context.slice(0, 120) });
        if (name === "target") target = null; else previousTarget = null;
      } else if (!supportedStoredTargetUnit(context)) {
        add({ code: "forecast_unit_unsupported", field: `${field}.${name}`, detail: context.slice(0, 120) });
        if (name === "target") target = null; else previousTarget = null;
      }
    }

    return { ...claim, target, previousTarget, timeHorizon };
  });

  return {
    passed: issues.length === 0,
    score: Number(Math.max(0, 1 - issues.length * 0.12).toFixed(2)),
    issues,
    forecasts: safeForecasts,
  };
}
