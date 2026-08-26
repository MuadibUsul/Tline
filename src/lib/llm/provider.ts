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

export function getLLMProvider(preferred = process.env.LLM_PROVIDER): LLMProvider | null {
  const order = preferred?.toLowerCase() === "openai"
    ? ["openai", "anthropic"]
    : preferred?.toLowerCase() === "anthropic"
      ? ["anthropic", "openai"]
      : ["anthropic", "openai"];
  for (const name of order) {
    if (name === "anthropic" && process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
    if (name === "openai" && process.env.OPENAI_API_KEY) return new OpenAIProvider();
  }
  return null;
}

export async function completeJSON<T>(
  provider: LLMProvider,
  input: CompletionInput,
): Promise<{ value: T; meta: CompletionResult }> {
  const meta = await provider.complete(input);
  const match = meta.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`${meta.provider} did not return a JSON object.`);
  return { value: JSON.parse(match[0]) as T, meta };
}

export type { CompletionInput, CompletionResult, LLMProvider } from "./types";
