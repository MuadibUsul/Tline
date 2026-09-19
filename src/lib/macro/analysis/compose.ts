import { completeJSON, type LLMProvider } from "../../llm/provider";
import { buildFacts, toNumber, type FactInput, type Playbook, type ReleaseFacts } from "./facts";
import { fallbackReadOut, readOutViolations, type ReadOut } from "./guard";
import type { AnalysisContext } from "./context";
import type { CompletionAudit } from "../../llm/types";

/**
 * Writing the read-out.
 *
 * The model is not asked to be an analyst from scratch — it is given the arithmetic, the
 * retrieved context and a small set of questions the desk would actually ask, and it is
 * asked to answer them in the register a strategist writes in. Two rules keep it honest:
 * everything quotable is already computed, and the draft is checked against those facts
 * before it is accepted. A rejected draft is retried once with the violations spelled out;
 * if that fails, the arithmetic speaks for itself.
 */
const STYLE = `Style rules, in order of importance:
1. Write about the economy and markets, never about your own process. Do not mention evidence classes, data sources, verification, what the analysis can or cannot say, what data is missing, or that it was generated. If a comparison is unavailable, say nothing about it — do not explain its absence.
2. Lead with what the number means, not with what it was. A reader has already seen the print.
3. Prefer concrete mechanisms over adjectives: what drove the change, what it implies for policy or positioning, what would falsify the view.
4. Use only the numbers in FACTS. Never introduce a statistic, level, percentage or ranking that is not there — no "highest on record", "biggest since", "largest of the cycle" unless a fact says so.
5. Restrained and specific. No investment advice, no price targets, no superlatives.
6. At most four paragraphs, and no paragraph that only restates an earlier one.`;

const systemFor = (locale: "en" | "zh-CN") => locale === "en"
  ? `You write macro read-outs for professional investors. Write in English only.

${STYLE}

Return ONLY JSON:
{"headline": string, "read": string, "implication": string, "watch": string}
- headline: one sentence, under 90 characters, the conclusion a desk would repeat.
- read: 2-4 short paragraphs of analysis (not a list) answering the playbook questions.
- implication: one or two sentences on what it means for policy or positioning.
- watch: one sentence naming the next catalyst or the condition that invalidates the read.`
  : `你为专业投资者撰写宏观数据解读。只输出简体中文，用市场通行的术语与表达，不要写成英文的翻译腔。

${STYLE}

只返回 JSON：
{"headline": string, "read": string, "implication": string, "watch": string}
- headline：一句话结论，不超过 40 个汉字，是交易台会转述的那句。
- read：2-4 段简短分析（不要写成条目）回答手册中的问题。
- implication：一到两句话，说明对政策或仓位的含义。
- watch：一句话，指明下一个催化剂或使该判断失效的条件。`;


function questionsBlock(playbook: Playbook) {
  return playbook.questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
}

function contextBlock(context: AnalysisContext) {
  const lines: string[] = [];
  if (context.hitRate) lines.push(`Recent pattern: ${context.hitRate}.`);
  for (const row of context.recentSurprises) lines.push(`  ${row.period}: actual ${row.actual}${row.consensus ? ` vs consensus ${row.consensus}` : ""} — ${row.verdict}`);
  if (context.institutionForecasts) {
    const forecasts = context.institutionForecasts;
    lines.push(`Institution research forecasts for this release: median ${forecasts.median}, range ${forecasts.range.min}–${forecasts.range.max}, from ${forecasts.count} forecasts (${forecasts.contributors.join(", ")}).`);
  }
  if (context.related.length) {
    lines.push("Related series, latest published:");
    for (const row of context.related) lines.push(`  ${row.nameEn}: ${row.value} (${row.period})`);
  }
  if (context.marketReaction.length && context.marketWindowMinutes !== null) {
    lines.push(`Market reaction in the ${context.marketWindowMinutes} minutes since the print: ${context.marketReaction.map((move) => `${move.symbol} ${move.changePct > 0 ? "+" : ""}${move.changePct}%`).join(", ")}.`);
  }
  if (context.policyDelta) {
    lines.push(`Policy language versus the ${context.policyDelta.previousMeeting} statement: ${context.policyDelta.changes.length ? context.policyDelta.changes.join("; ") : "no substantive change in the parsed fields"}.`);
  }
  return lines.join("\n");
}

export function analysisPrompt(facts: ReleaseFacts, context: AnalysisContext, playbook: Playbook) {
  const factsBlock = [
    `Release: ${facts.title} (${facts.family}), as of ${facts.asOf}.`,
    "FACTS (computed, the only numbers you may use):",
    ...facts.values.map((value) => [
      `  ${value.nameEn} (${value.unit}): actual ${value.actual}`,
      value.consensus === null ? "consensus not recorded" : `consensus ${value.consensus}`,
      value.previous === null ? "previous not recorded" : `previous ${value.previous}`,
      value.change === null ? null : `change ${value.change}`,
      value.surprise === null ? null : `surprise ${value.surprise}${value.surpriseSd === null ? "" : ` (${value.surpriseSd} sd)`}`,
      value.changePercentile === null ? null : `change percentile ${value.changePercentile}`,
      value.momentum === null ? null : `${value.momentumLabel} ${value.momentum}`,
      value.revision,
    ].filter(Boolean).join(", ")),
    "",
    "ESTABLISHED (stated by the arithmetic — use these, do not re-derive):",
    ...facts.labels.map((label) => `  ${label}`),
    "",
    `Topic to write about: ${playbook.topic}.`,
    playbook.notes ? `Desk note: ${playbook.notes}` : "",
    "Questions the read-out should answer:",
    questionsBlock(playbook),
  ].filter(Boolean).join("\n");
  const contextText = contextBlock(context);
  return `${factsBlock}${contextText ? `\n\nCONTEXT (retrieved, may be quoted):\n${contextText}` : ""}`;
}

export interface ComposedReadOut {
  readOut: ReadOut;
  /** Which locale's text this is; the pipeline composes both. */
  violations: string[];
  fallback: boolean;
}

async function attempt(provider: LLMProvider, system: string, user: string, maxTokens: number, audit?: CompletionAudit) {
  const { value } = await completeJSON<Partial<ReadOut>>(provider, { system, user, maxTokens, audit });
  return { headline: value.headline?.trim() ?? "", read: value.read?.trim() ?? "", implication: value.implication?.trim() ?? "", watch: value.watch?.trim() ?? "" };
}

/**
 * Compose one locale, retrying once with the violations attached.
 *
 * The retry is the part that makes the guard useful rather than punitive: the model is told
 * exactly which sentence broke which rule, which is enough to fix a style slip or a
 * fabricated figure without another round trip.
 */
export async function composeReadOut(input: {
  provider: LLMProvider;
  facts: ReleaseFacts;
  context: AnalysisContext;
  playbook: Playbook;
  locale: "en" | "zh-CN";
  audit?: CompletionAudit;
}): Promise<ComposedReadOut> {
  const base = analysisPrompt(input.facts, input.context, input.playbook);
  const user = input.locale === "en"
    ? `${base}\n\nWrite the English read-out.`
    // The Chinese read-out is written from the same facts rather than translated, so the
    // wording is native on both sides; the English draft is deliberately not shown to it.
    : `${base}\n\n只输出中文解读（JSON 中的四个字段都用中文，术语用市场通行译法）。`;
  let violations: string[] = [];
  for (let round = 0; round < 2; round++) {
    const draft = await attempt(input.provider, systemFor(input.locale), round === 0 ? user : `${user}\n\nThe previous draft was rejected. Fix exactly these and keep everything else:\n- ${violations.join("\n- ")}`, 4000, input.audit);
    if (!draft.headline && !draft.read) { violations = ["the response was empty"]; continue; }
    violations = readOutViolations({ readOut: draft, facts: input.facts });
    if (!violations.length) return { readOut: draft, violations: [], fallback: false };
  }
  return { readOut: fallbackReadOut(input.facts, input.locale), violations, fallback: true };
}

export interface ReleaseAnalysisResult {
  facts: ReleaseFacts;
  en: ReadOut;
  zh: ReadOut;
  fallback: boolean;
  violations: string[];
}

/** The pipeline: compute, retrieve, write, check. */
export async function composeReleaseAnalysis(input: {
  provider: LLMProvider;
  factInput: FactInput;
  context: AnalysisContext;
  playbook: Playbook;
  audit?: CompletionAudit;
}): Promise<ReleaseAnalysisResult> {
  const facts = buildFacts(input.factInput);
  const [en, zh] = await Promise.all([
    composeReadOut({ provider: input.provider, facts, context: input.context, playbook: input.playbook, locale: "en", audit: input.audit }),
    composeReadOut({ provider: input.provider, facts, context: input.context, playbook: input.playbook, locale: "zh-CN", audit: input.audit }),
  ]);
  // A beat/miss claim in one language and not the other is still a claim: check both against
  // both, since the two drafts are written independently.
  const pairViolations = [
    ...readOutViolations({ readOut: en.readOut, facts, otherLocale: [zh.readOut.headline, zh.readOut.read, zh.readOut.implication, zh.readOut.watch].join("\n") }),
    ...readOutViolations({ readOut: zh.readOut, facts, otherLocale: [en.readOut.headline, en.readOut.read, en.readOut.implication, en.readOut.watch].join("\n") }),
  ];
  return { facts, en: en.readOut, zh: zh.readOut, fallback: en.fallback || zh.fallback, violations: [...en.violations, ...zh.violations, ...pairViolations] };
}

/**
 * The stored form: prose that reads as one piece, with the conclusion first.
 *
 * The site renders these two fields as they are, so the structure lives in the text rather
 * than in new columns — and the headline-first shape is what makes the page skimmable.
 */
export function formatAnalysis(readOut: ReadOut) {
  return [readOut.headline, readOut.read, readOut.implication, readOut.watch].map((part) => part.trim()).filter(Boolean).join("\n\n");
}

export const factHelpers = { toNumber };
