import { recordLlmCall } from "./usage";
import {
  isProviderName,
  normalizeFinishReason,
  PROVIDER_NAMES,
  type CompletionInput,
  type CompletionResult,
  type CompletionUsage,
  type LlmTask,
  type LLMProvider,
  type ProviderName,
} from "./types";

/**
 * Explicit credentials for a provider, overriding whatever the environment says.
 *
 * Configuration lives in the database so it can be changed from the console without a
 * redeploy; the environment remains the fallback, so a deployment that has never opened
 * the console keeps working exactly as before.
 */
export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

function pick(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => value && value.trim().length > 0);
}

class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;

  constructor(config: ProviderConfig = {}) {
    this.model = pick(config.model, process.env.ANTHROPIC_MODEL, process.env.LLM_MODEL) || "claude-sonnet-4-5-20250929";
    this.apiKey = pick(config.apiKey, process.env.ANTHROPIC_API_KEY) || "";
  }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });
    const response = await client.messages.create({
      model: this.model,
      max_tokens: input.maxTokens ?? 1800,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });
    const text = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("Anthropic returned an empty completion.");
    return {
      text,
      provider: this.name,
      model: this.model,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      finishReason: normalizeFinishReason(response.stop_reason),
    };
  }
}

class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.model = pick(config.model, process.env.OPENAI_MODEL, process.env.LLM_MODEL) || "gpt-5.4";
    this.apiKey = pick(config.apiKey, process.env.OPENAI_API_KEY) || "";
    this.baseUrl = (pick(config.baseUrl, process.env.OPENAI_BASE_URL) || "https://api.openai.com").replace(/\/$/, "");
  }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const response = await fetch(`${this.baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        instructions: input.system,
        input: input.user,
        max_output_tokens: input.maxTokens ?? 1800,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    }
    const data = await response.json() as {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      status?: string;
      incomplete_details?: { reason?: string };
    };
    const text = (data.output_text || data.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text" || item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n") || "").trim();
    if (!text) throw new Error("OpenAI returned an empty completion.");
    return {
      text,
      provider: this.name,
      model: this.model,
      usage: usageOf(data.usage?.input_tokens, data.usage?.output_tokens),
      // The Responses API reports truncation as an incomplete status with a separate
      // reason, rather than as a finish reason on the message.
      finishReason: normalizeFinishReason(data.incomplete_details?.reason ?? data.status),
    };
  }
}

class DeepSeekProvider implements LLMProvider {
  readonly name = "deepseek";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.model = pick(config.model, process.env.DEEPSEEK_MODEL, process.env.LLM_MODEL) || "deepseek-v4-flash";
    this.apiKey = pick(config.apiKey, process.env.DEEPSEEK_API_KEY) || "";
    this.baseUrl = (pick(config.baseUrl, process.env.DEEPSEEK_BASE_URL) || "https://api.deepseek.com").replace(/\/$/, "");
  }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        max_tokens: input.maxTokens ?? 1800,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`DeepSeek request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    }
    const data = await response.json() as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    if (!text) throw new Error("DeepSeek returned an empty completion.");
    return {
      text,
      provider: this.name,
      model: this.model,
      usage: usageOf(data.usage?.prompt_tokens, data.usage?.completion_tokens),
      finishReason: normalizeFinishReason(data.choices?.[0]?.finish_reason),
    };
  }
}

class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    // Do not fall back to the cross-provider LLM_MODEL — that leaks another vendor's model name.
    this.model = pick(config.model, process.env.GEMINI_MODEL) || "gemini-3.6-flash";
    this.apiKey = pick(config.apiKey, process.env.GEMINI_API_KEY) || "";
    this.baseUrl = (pick(config.baseUrl, process.env.GEMINI_BASE_URL) || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const response = await fetch(`${this.baseUrl}/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.user }] }],
        generationConfig: { maxOutputTokens: input.maxTokens ?? 1800, temperature: 0, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`Gemini request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    }
    const data = await response.json() as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = (data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") || "").trim();
    if (!text) throw new Error("Gemini returned an empty completion.");
    return {
      text,
      provider: this.name,
      model: this.model,
      usage: usageOf(data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount),
      finishReason: normalizeFinishReason(data.candidates?.[0]?.finishReason),
    };
  }
}

/** Absent rather than zero when a provider reports nothing, so "unknown" stays distinguishable. */
function usageOf(input: number | undefined, output: number | undefined): CompletionUsage | undefined {
  if (typeof input !== "number" && typeof output !== "number") return undefined;
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

export function createProvider(name: ProviderName, config: ProviderConfig = {}): LLMProvider {
  if (name === "anthropic") return new AnthropicProvider(config);
  if (name === "openai") return new OpenAIProvider(config);
  if (name === "deepseek") return new DeepSeekProvider(config);
  return new GeminiProvider(config);
}

const ENV_KEYS: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export function envApiKey(name: ProviderName): string | undefined {
  return pick(process.env[ENV_KEYS[name]]);
}

/**
 * Environment-only resolution, unchanged from before the console existed.
 *
 * Still the fallback inside resolveLLMProvider, and what the CLIs use to answer "is
 * anything configured at all" before they start work.
 */
export function getLLMProvider(preferred = process.env.LLM_PROVIDER): LLMProvider | null {
  const requested = preferred?.toLowerCase();
  const order = requested && isProviderName(requested)
    ? [requested, ...PROVIDER_NAMES.filter((name) => name !== requested)]
    : [...PROVIDER_NAMES];
  for (const name of order) {
    if (envApiKey(name)) return createProvider(name);
  }
  return null;
}

/**
 * Records every call it forwards.
 *
 * A decorator rather than a change inside each provider: the four of them differ only in
 * how they talk to their vendor, and duplicating the bookkeeping four times is how the
 * counts drift apart.
 */
class RecordingProvider implements LLMProvider {
  constructor(private readonly inner: LLMProvider, private readonly task: LlmTask) {}

  get name() { return this.inner.name; }
  get model() { return this.inner.model; }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const startedAt = Date.now();
    try {
      const result = await this.inner.complete(input);
      await recordLlmCall({
        task: this.task,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        finishReason: result.finishReason,
        durationMs: Date.now() - startedAt,
        ok: true,
        audit: input.audit,
      });
      return result;
    } catch (error) {
      // A failed call still consumed a request slot, and often output tokens too — a
      // truncated completion is billed for what it generated. Losing these rows hides
      // exactly the failures that cost the most.
      await recordLlmCall({
        task: this.task,
        provider: this.inner.name,
        model: this.inner.model,
        durationMs: Date.now() - startedAt,
        ok: false,
        error: String(error),
        audit: input.audit,
      });
      throw error;
    }
  }
}

export function withUsageRecording(provider: LLMProvider, task: LlmTask): LLMProvider {
  return new RecordingProvider(provider, task);
}

export async function completeJSON<T>(
  provider: LLMProvider,
  input: CompletionInput,
  maxAttempts = 2,
): Promise<{ value: T; meta: CompletionResult }> {
  let meta: CompletionResult | null = null;
  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt++) {
    meta = await provider.complete(attempt === 0 ? input : {
      ...input,
      system: `${input.system}\nYour previous response was invalid JSON. Return one syntactically valid JSON object only.`,
    });
    const value = firstJsonObject<T>(meta.text);
    if (value !== null) return { value, meta };
  }
  throw new Error(`${meta?.provider ?? provider.name} did not return a valid JSON object.`);
}

function firstJsonObject<T>(text: string): T | null {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try { return JSON.parse(text.slice(start, index + 1)) as T; } catch { break; }
      }
    }
  }
  return null;
}

export type { CompletionInput, CompletionResult, LLMProvider } from "./types";
