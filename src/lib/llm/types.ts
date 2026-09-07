export interface CompletionInput {
  system: string;
  user: string;
  maxTokens?: number;
}

/** Token counts as the provider itself reported them, when it reported them. */
export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  provider: string;
  model: string;
  usage?: CompletionUsage;
  /**
   * Why generation stopped, normalised across vendors: "stop", "length", "filter", or the
   * vendor's own word when it is none of those. Token counts cannot express this — a reply
   * cut off at the ceiling bills for every token it produced and looks like a normal call.
   */
  finishReason?: FinishReason;
}

export type FinishReason = "stop" | "length" | "filter" | (string & {});

/** Each vendor spells the same three outcomes differently. */
export function normalizeFinishReason(raw: string | null | undefined): FinishReason | undefined {
  if (!raw) return undefined;
  const value = raw.toLowerCase();
  if (value === "stop" || value === "end_turn" || value === "completed" || value === "stop_sequence") return "stop";
  if (value === "length" || value === "max_tokens" || value === "max_output_tokens") return "length";
  if (value === "content_filter" || value === "safety" || value === "recitation") return "filter";
  return value;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(input: CompletionInput): Promise<CompletionResult>;
}

/**
 * The model-backed jobs, each routable to its own provider and model.
 *
 * Named after what the call is for rather than which file makes it, because that is what
 * an operator choosing a model is actually deciding about.
 */
export const LLM_TASKS = [
  "translation",
  "translation_review",
  "analysis",
  "forecast",
  "release_analysis",
  "policy",
  "retitle",
] as const;

export type LlmTask = (typeof LLM_TASKS)[number];

export function isLlmTask(value: string): value is LlmTask {
  return (LLM_TASKS as readonly string[]).includes(value);
}

export const PROVIDER_NAMES = ["anthropic", "openai", "deepseek", "gemini"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}
