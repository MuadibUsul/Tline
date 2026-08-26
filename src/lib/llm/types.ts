export interface CompletionInput {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  provider: string;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(input: CompletionInput): Promise<CompletionResult>;
}
