import { resolveLLMProvider } from "../../llm/config";
import { completeJSON, type LLMProvider } from "../../llm/provider";
import type { ParsedPolicyDocument, PolicyDecision, PolicyParseResult, PolicySourceQuote, PolicyStance } from "./types";
import { buildTaskContext, CONTEXT_BUILDER_VERSION } from "../../llm/context-builder";
import { decideAiExecution, recordAiExecutionEvent } from "../../llm/execution-policy";
import { createHash } from "node:crypto";

export const POLICY_PROMPT_VERSION = "fomc-policy-v1";
const RATE = String.raw`(?:\d+(?:\.\d+)?(?:[- ]\d+\/\d+)?|\d+\/\d+)`;
const DECISIONS = new Set<PolicyDecision>(["HIKE", "CUT", "HOLD", "OTHER"]);
const STANCES = new Set<PolicyStance>(["HAWKISH", "DOVISH", "NEUTRAL", "MIXED", "UNKNOWN"]);

function rate(value: string): number | null {
  const text = value.trim().replace("¼", " 1/4").replace("½", " 1/2").replace("¾", " 3/4");
  const mixed = text.match(/^(\d+)[- ](\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function quote(field: string, value: string): PolicySourceQuote {
  return { field, quote: value.replace(/\s+/g, " ").trim() };
}

function names(value: string): number | null {
  const clean = value.replace(/,?\s+who\s+(?:preferred|dissented|supported)[\s\S]*$/i, "").trim();
  const list = clean.split(/,\s+|\s+and\s+/i).map((item) => item.trim()).filter(Boolean);
  return list.length && list.every((item) => /[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+)+/.test(item)) ? list.length : null;
}

export function extractDeterministicPolicy(text: string): ParsedPolicyDocument {
  const sourceQuotes: PolicySourceQuote[] = [];
  const paragraphs = text.split(/\n{2,}/);
  const rangePattern = new RegExp(`target range for the federal funds rate[\\s\\S]{0,160}?(${RATE})\\s+(?:to|and|–|—)\\s+(${RATE})\\s+percent`, "i");
  const rangeMatch = text.match(rangePattern);
  const targetRateLower = rangeMatch ? rate(rangeMatch[1]) : null;
  const targetRateUpper = rangeMatch ? rate(rangeMatch[2]) : null;
  if (rangeMatch) sourceQuotes.push(quote("targetRate", rangeMatch[0]));

  const decisionMatch = text.match(/(?:decided|agreed)\s+to\s+(raise|increase|lower|reduce|maintain|keep|retain)[\s\S]{0,180}?target range for the federal funds rate/i)
    ?? text.match(/(raised|increased|lowered|reduced|maintained|kept|retained)[\s\S]{0,120}?target range for the federal funds rate/i);
  const verb = decisionMatch?.[1]?.toLowerCase();
  const decision: PolicyDecision = verb && /raise|increase/.test(verb) ? "HIKE"
    : verb && /lower|reduce/.test(verb) ? "CUT"
      : verb && /maintain|keep|retain/.test(verb) ? "HOLD" : "OTHER";
  if (decisionMatch) sourceQuotes.push(quote("decision", decisionMatch[0]));

  const decisionParagraph = paragraphs.find((paragraph) => /(?:The Committee|FOMC)[\s\S]{0,80}?(?:decided|agreed)\s+to/i.test(paragraph)) ?? "";
  const changeMatch = decision === "HOLD" ? null
    : decisionParagraph.match(new RegExp(`(?:raise(?:d)?|increase(?:d)?|lower(?:ed)?|reduce(?:d)?)[\\s\\S]{0,120}?by\\s+(${RATE})\\s+(basis points?|percentage points?)`, "i"));
  let changeBps: number | null = decision === "HOLD" ? 0 : null;
  if (changeMatch) {
    const amount = rate(changeMatch[1]);
    if (amount !== null) changeBps = amount * (/basis/i.test(changeMatch[2]) ? 1 : 100) * (decision === "CUT" ? -1 : 1);
    sourceQuotes.push(quote("changeBps", changeMatch[0]));
  }

  let votesFor: number | null = null;
  let votesAgainst: number | null = null;
  const tally = text.match(/(?:approved|adopted)[\s\S]{0,100}?by a\s+(\d+)\s*[–—-]\s*(\d+)\s+vote/i);
  if (tally) {
    votesFor = Number(tally[1]);
    votesAgainst = Number(tally[2]);
    sourceQuotes.push(quote("votes", tally[0]));
  }
  const voteParagraph = paragraphs.find((paragraph) => /Voting for (?:the monetary policy|this) action/i.test(paragraph));
  if (!tally && voteParagraph) {
    const forMatch = voteParagraph.match(/Voting for (?:the monetary policy|this) action (?:were|was) ([\s\S]*?)(?=\.\s+(?:Voting against|Absent)|\.$|$)/i);
    const againstMatch = voteParagraph.match(/Voting against (?:this|the) action (?:were|was) ([\s\S]*?)(?=,\s+who|\.\s+(?:Absent|Voting)|\.$|$)/i);
    votesFor = forMatch ? names(forMatch[1]) : null;
    votesAgainst = againstMatch ? names(againstMatch[1]) : forMatch ? 0 : null;
    if (votesFor !== null) sourceQuotes.push(quote("votes", voteParagraph));
  }

  return {
    decision,
    targetRateLower,
    targetRateUpper,
    changeBps,
    stance: "UNKNOWN",
    inflationAssessment: "",
    growthAssessment: "",
    laborAssessment: "",
    forwardGuidance: "",
    balanceSheetAction: "",
    votesFor,
    votesAgainst,
    sourceQuotes,
    confidence: rangeMatch && decisionMatch ? 0.95 : decisionMatch ? 0.8 : 0,
  };
}

const SYSTEM = `Extract only evidence explicitly stated in this Federal Reserve policy document. Do not guess.
Return exactly one JSON object with this shape:
{"decision":"HIKE|CUT|HOLD|OTHER","targetRateLower":number|null,"targetRateUpper":number|null,"changeBps":number|null,"stance":"HAWKISH|DOVISH|NEUTRAL|MIXED|UNKNOWN","inflationAssessment":string,"growthAssessment":string,"laborAssessment":string,"forwardGuidance":string,"balanceSheetAction":string,"votesFor":number|null,"votesAgainst":number|null,"sourceQuotes":[{"field":string,"quote":string}],"confidence":number}
Every non-empty assessment and every decision, stance, forward-guidance, or balance-sheet judgment must have an exact source quote. Use null or empty string when absent. Never infer numeric values.`;

function normalized(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function mergeLlm(deterministic: ParsedPolicyDocument, value: unknown, text: string): ParsedPolicyDocument {
  if (!value || typeof value !== "object") return deterministic;
  const input = value as Record<string, unknown>;
  const source = normalized(text);
  const llmQuotes = Array.isArray(input.sourceQuotes) ? input.sourceQuotes.flatMap((item): PolicySourceQuote[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.field !== "string" || typeof record.quote !== "string" || !source.includes(normalized(record.quote))) return [];
    return [quote(record.field, record.quote)];
  }) : [];
  const hasQuote = (field: string) => llmQuotes.some((item) => item.field === field);
  const semantic = (field: string) => typeof input[field] === "string" && hasQuote(field) ? String(input[field]).trim() : "";
  const decision = deterministic.decision === "OTHER" && DECISIONS.has(input.decision as PolicyDecision) && hasQuote("decision")
    ? input.decision as PolicyDecision : deterministic.decision;
  const stance = STANCES.has(input.stance as PolicyStance) && input.stance !== "UNKNOWN" && hasQuote("stance")
    ? input.stance as PolicyStance : "UNKNOWN";
  const confidence = Math.max(0, Math.min(1, Number(input.confidence) || deterministic.confidence));
  const allQuotes = [...deterministic.sourceQuotes, ...llmQuotes]
    .filter((item, index, rows) => rows.findIndex((other) => other.field === item.field && other.quote === item.quote) === index);
  return {
    ...deterministic,
    decision,
    stance,
    inflationAssessment: semantic("inflationAssessment"),
    growthAssessment: semantic("growthAssessment"),
    laborAssessment: semantic("laborAssessment"),
    forwardGuidance: semantic("forwardGuidance"),
    balanceSheetAction: semantic("balanceSheetAction"),
    sourceQuotes: allQuotes,
    confidence,
  };
}

/** Undefined resolves from configuration; an explicit null forces the deterministic path. */
export async function parsePolicyDocument(text: string, injected?: LLMProvider | null): Promise<PolicyParseResult> {
  const provider = injected === undefined ? await resolveLLMProvider("policy") : injected;
  const deterministic = extractDeterministicPolicy(text);
  if (!provider) return { parsed: deterministic, provider: "deterministic", model: null, promptVersion: POLICY_PROMPT_VERSION, reviewStatus: "deterministic" };
  try {
    const context = buildTaskContext("policy", { text });
    const policy = decideAiExecution({
      taskType: "policy",
      contentHash: createHash("sha256").update(text).digest("hex"),
      promptVersion: POLICY_PROMPT_VERSION,
      contextBuilderVersion: CONTEXT_BUILDER_VERSION,
      requestedOutput: "policy",
      sourceInfo: { requiresFullText: true },
      route: { provider: provider.name, model: provider.model },
    });
    const result = await completeJSON<unknown>(provider, {
      system: SYSTEM,
      user: context.selectedText,
      maxTokens: 2200,
      audit: {
        requestFingerprint: policy.fingerprint,
        promptVersion: POLICY_PROMPT_VERSION,
        executionLevel: policy.executionLevel,
        contextStrategy: context.strategy,
        cacheStatus: "MISS",
        reasonCodes: policy.reasonCodes,
        originalEstimatedTokens: context.originalEstimatedTokens,
        optimizedEstimatedTokens: context.estimatedTokens,
      },
    });
    await recordAiExecutionEvent({
      task: "policy", policy, cacheStatus: "MISS",
      originalEstimatedTokens: context.originalEstimatedTokens,
      optimizedEstimatedTokens: context.estimatedTokens,
      actualInputTokens: result.meta.usage?.inputTokens,
    });
    return {
      parsed: mergeLlm(deterministic, result.value, text),
      provider: result.meta.provider,
      model: result.meta.model,
      promptVersion: POLICY_PROMPT_VERSION,
      reviewStatus: "parsed",
    };
  } catch {
    return { parsed: deterministic, provider: provider.name, model: provider.model, promptVersion: POLICY_PROMPT_VERSION, reviewStatus: "needs_review" };
  }
}
