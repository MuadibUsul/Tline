import type { LlmTask } from "./types";
import type { ContextStrategy, ReasonCode } from "./execution-policy";

export const CONTEXT_BUILDER_VERSION = "context-v1";
export type ContextTask = LlmTask | "classification" | "source_consistency";

export interface ContextSection { heading?: string | null; text: string }
export interface ContextDocument { title?: string; subtitle?: string; text: string; sections?: ContextSection[] }
export interface BuiltContext {
  selectedText: string;
  selectedSections: string[];
  originalEstimatedTokens: number;
  estimatedTokens: number;
  strategy: ContextStrategy;
  insufficientContext: boolean;
  reasonCodes: ReasonCode[];
  structuredMetadata: Record<string, unknown>;
}

export interface ContextBuildOptions {
  structuredMetadata?: Record<string, unknown>;
  classification?: Record<string, unknown>;
  preferredInputTokens?: number;
  maxInputTokens?: number;
  fullTextAllowed?: boolean;
}

const headingPatterns: Partial<Record<ContextTask, RegExp>> = {
  classification: /summary|executive|introduction|key findings?|conclusion|scope|overview/i,
  source_consistency: /summary|executive|key findings?|conclusion|risk|caveat|appendix/i,
  analysis: /summary|executive|key findings?|outlook|conclusion|inflation|growth|employment|policy|market|risk/i,
  forecast: /summary|forecast|outlook|projection|expect|target|conclusion/i,
  release_analysis: /summary|actual|consensus|previous|revision|market|policy/i,
  retitle: /summary|executive|introduction|key findings?/i,
};

export function estimateTokens(text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  const cjk = (clean.match(/[\u3400-\u9fff]/g) ?? []).length;
  return Math.ceil(cjk + (clean.length - cjk) / 4);
}

function budget(task: ContextTask, kind: "PREFERRED" | "MAX", override?: number): number {
  if (Number.isFinite(override) && Number(override) > 0) return Math.floor(Number(override));
  const key = `AI_CONTEXT_${task.toUpperCase()}_${kind}_TOKENS`;
  const configured = Number(process.env[key]);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  if (task === "translation" || task === "translation_review" || task === "policy") return 100_000;
  return kind === "PREFERRED" ? 6_000 : 16_000;
}

const join = (document: ContextDocument, sections: ContextSection[]) => [
  document.title?.trim(), document.subtitle?.trim(),
  ...sections.flatMap((section) => [section.heading?.trim(), section.text.trim()]),
].filter(Boolean).join("\n\n");

function inferredSections(text: string): ContextSection[] {
  const paragraphs = text.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs.map((part) => {
    const [first, ...rest] = part.split("\n");
    return first.length <= 100 && rest.length ? { heading: first, text: rest.join("\n") } : { text: part };
  });
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
  const sections: ContextSection[] = [];
  for (let index = 0; index < sentences.length; index += 5) sections.push({ text: sentences.slice(index, index + 5).join(" ") });
  return sections;
}

export function buildTaskContext(task: ContextTask, document: ContextDocument, options: ContextBuildOptions = {}): BuiltContext {
  const fullText = document.text.trim();
  const originalEstimatedTokens = estimateTokens(fullText);
  const fullRequired = task === "translation" || task === "translation_review" || task === "policy";
  const structuredMetadata = { ...(options.structuredMetadata ?? {}), ...(options.classification ? { classification: options.classification } : {}) };
  const preferred = budget(task, "PREFERRED", options.preferredInputTokens);
  const maximum = budget(task, "MAX", options.maxInputTokens);
  if (fullRequired || originalEstimatedTokens <= preferred) return {
    selectedText: fullText,
    selectedSections: document.sections?.map((section) => section.heading?.trim()).filter((value): value is string => Boolean(value)) ?? [],
    originalEstimatedTokens,
    estimatedTokens: originalEstimatedTokens,
    strategy: "FULL",
    insufficientContext: false,
    reasonCodes: [fullRequired ? "FULL_CONTEXT_REQUIRED" : "WITHIN_CONTEXT_BUDGET"],
    structuredMetadata,
  };

  const sections = (document.sections?.length ? document.sections : inferredSections(fullText)).filter((section) => section.text.trim());
  const pattern = headingPatterns[task] ?? /summary|executive|introduction|key findings?|conclusion/i;
  const selected = sections.filter((section, index) => index === 0 || index === sections.length - 1 || pattern.test(`${section.heading ?? ""} ${section.text.slice(0, 180)}`));
  let chosen = [...new Set(selected)];
  let strategy: ContextStrategy = "SELECTIVE";
  let selectedText = join(document, chosen);
  const minimum = Math.min(500, Math.max(120, Math.ceil(originalEstimatedTokens * 0.08)));

  if (estimateTokens(selectedText) < minimum && chosen.length < sections.length) {
    chosen = sections.filter((_, index) => index < 4 || index >= sections.length - 2 || selected.includes(sections[index]));
    strategy = "EXPANDED";
    selectedText = join(document, chosen);
  }

  if (estimateTokens(selectedText) > maximum && options.fullTextAllowed === false) {
    const candidates = chosen.flatMap((section, sectionIndex) => {
      const parts = inferredSections(section.text);
      return parts.map((part, partIndex) => ({
        ...part,
        heading: partIndex === 0 ? section.heading : null,
        order: sectionIndex * 10_000 + partIndex,
        priority: sectionIndex === 0 || sectionIndex === chosen.length - 1 ? 3 : pattern.test(`${section.heading ?? ""} ${part.text}`) ? 2 : 1,
      }));
    });
    const bounded: typeof candidates = [];
    let used = estimateTokens([document.title, document.subtitle].filter(Boolean).join("\n"));
    for (const candidate of [...candidates].sort((a, b) => b.priority - a.priority || a.order - b.order)) {
      const tokens = estimateTokens(`${candidate.heading ?? ""}\n${candidate.text}`);
      if (tokens > maximum || used + tokens > maximum) continue;
      bounded.push(candidate);
      used += tokens;
    }
    chosen = bounded.sort((a, b) => a.order - b.order);
    selectedText = join(document, chosen);
  }
  if (estimateTokens(selectedText) < minimum || estimateTokens(selectedText) > maximum) {
    // A disabled full-text fallback must never silently drop material. Mark the context
    // insufficient and return the best expanded selection for the caller to stop/review.
    if (options.fullTextAllowed === false) {
      const estimatedTokens = estimateTokens(selectedText);
      return {
        selectedText, selectedSections: chosen.map((section) => section.heading?.trim()).filter((value): value is string => Boolean(value)),
        originalEstimatedTokens, estimatedTokens, strategy, insufficientContext: true,
        reasonCodes: ["LOW_CONFIDENCE_ESCALATION"], structuredMetadata,
      };
    }
    strategy = "FULL";
    selectedText = fullText;
    chosen = sections;
  }

  const estimatedTokens = estimateTokens(selectedText);
  const insufficientContext = strategy === "FULL" && estimatedTokens > maximum;
  return {
    selectedText,
    selectedSections: chosen.map((section) => section.heading?.trim()).filter((value): value is string => Boolean(value)),
    originalEstimatedTokens,
    estimatedTokens,
    strategy,
    insufficientContext,
    reasonCodes: strategy === "FULL" ? ["FULL_CONTEXT_REQUIRED"] : ["REQUIRES_DEEP_REASONING"],
    structuredMetadata,
  };
}
