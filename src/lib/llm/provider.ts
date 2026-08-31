import type { CompletionInput, CompletionResult, LLMProvider } from "./types";

class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model = process.env.ANTHROPIC_MODEL || process.env.LLM_MODEL || "claude-sonnet-4-5-20250929";

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
    return { text, provider: this.name, model: this.model };
  }
}

class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly model = process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-5.4";

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
    };
    const text = (data.output_text || data.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text" || item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n") || "").trim();
    if (!text) throw new Error("OpenAI returned an empty completion.");
    return { text, provider: this.name, model: this.model };
  }
}

class DeepSeekProvider implements LLMProvider {
  readonly name = "deepseek";
  readonly model = process.env.DEEPSEEK_MODEL || process.env.LLM_MODEL || "deepseek-v4-flash";

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
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
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    if (!text) throw new Error("DeepSeek returned an empty completion.");
    return { text, provider: this.name, model: this.model };
  }
}

class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly model = process.env.GEMINI_MODEL || process.env.LLM_MODEL || "gemini-2.0-flash";

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
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
    const data = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = (data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") || "").trim();
    if (!text) throw new Error("Gemini returned an empty completion.");
    return { text, provider: this.name, model: this.model };
  }
}

export function getLLMProvider(preferred = process.env.LLM_PROVIDER): LLMProvider | null {
  const providers = ["anthropic", "openai", "deepseek", "gemini"];
  const requested = preferred?.toLowerCase();
  const order = requested && providers.includes(requested)
    ? [requested, ...providers.filter((name) => name !== requested)]
    : providers;
  for (const name of order) {
    if (name === "anthropic" && process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
    if (name === "openai" && process.env.OPENAI_API_KEY) return new OpenAIProvider();
    if (name === "deepseek" && process.env.DEEPSEEK_API_KEY) return new DeepSeekProvider();
    if (name === "gemini" && process.env.GEMINI_API_KEY) return new GeminiProvider();
  }
  return null;
}

export async function completeJSON<T>(
  provider: LLMProvider,
  input: CompletionInput,
): Promise<{ value: T; meta: CompletionResult }> {
  let meta = await provider.complete(input);
  for (let attempt = 0; attempt < 2; attempt++) {
    const value = firstJsonObject<T>(meta.text);
    if (value !== null) return { value, meta };
    if (attempt === 0) meta = await provider.complete({ ...input, system: `${input.system}\nYour previous response was invalid JSON. Return one syntactically valid JSON object only.` });
  }
  throw new Error(`${meta.provider} did not return a valid JSON object.`);
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
