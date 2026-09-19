import type {
  ChoiceAnswer,
  DecisionAnswer,
  DecisionProvider,
  DecisionRequest,
  DecisionResponse,
  NoulAnswer,
  ScoreAnswer,
} from "./types";
import { recordDecisionCall, type DecisionCallRecord } from "./usage";

type Fetch = typeof fetch;
type Recorder = (record: DecisionCallRecord) => Promise<void>;

export interface JevDecisionProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: Fetch;
  recorder?: Recorder;
}

export class DecisionProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DecisionProviderError";
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecisionProviderError(`Invalid Jev response: ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DecisionProviderError(`Invalid Jev response: ${path} must be a finite number`);
  }
  return value;
}

function probability(value: unknown, path: string): number {
  const parsed = number(value, path);
  if (parsed < 0 || parsed > 1) {
    throw new DecisionProviderError(`Invalid Jev response: ${path} must be between 0 and 1`);
  }
  return parsed;
}

function tokenCount(value: unknown, path: string): number {
  const parsed = number(value, path);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new DecisionProviderError(`Invalid Jev response: ${path} must be a non-negative integer`);
  }
  return parsed;
}

function probabilities(value: unknown, path: string): Record<string, number> {
  const input = object(value, path);
  return Object.fromEntries(Object.entries(input).map(([key, score]) => [key, probability(score, `${path}.${key}`)]));
}

function parseAnswer(value: unknown, path: string): DecisionAnswer {
  const answer = object(value, path);
  if (answer.type === "choice") {
    if (typeof answer.choice !== "string") throw new DecisionProviderError(`Invalid Jev response: ${path}.choice must be a string`);
    return {
      type: "choice",
      choice: answer.choice,
      probabilities: probabilities(answer.probabilities, `${path}.probabilities`),
      confidence: probability(answer.confidence, `${path}.confidence`),
    } satisfies ChoiceAnswer;
  }
  if (answer.type === "score") {
    const legend = object(answer.legend, `${path}.legend`);
    if (Object.values(legend).some((item) => typeof item !== "string")) {
      throw new DecisionProviderError(`Invalid Jev response: ${path}.legend values must be strings`);
    }
    return {
      type: "score",
      score: number(answer.score, `${path}.score`),
      legend: legend as Record<string, string>,
      probabilities: probabilities(answer.probabilities, `${path}.probabilities`),
      confidence: probability(answer.confidence, `${path}.confidence`),
    } satisfies ScoreAnswer;
  }
  if (answer.type === "noul") {
    return { type: "noul", noul: probability(answer.noul, `${path}.noul`) } satisfies NoulAnswer;
  }
  throw new DecisionProviderError(`Invalid Jev response: ${path}.type is unsupported`);
}

function parseResponse(value: unknown, request: DecisionRequest): Omit<DecisionResponse, "provider"> {
  const root = object(value, "response");
  if (typeof root.model !== "string") throw new DecisionProviderError("Invalid Jev response: model must be a string");
  const rawAnswers = object(root.answers, "response.answers");
  const answers: Record<string, DecisionAnswer> = {};
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = parseAnswer(rawAnswers[id], `response.answers.${id}`);
    if (answer.type !== question.type) throw new DecisionProviderError(`Invalid Jev response: answer type mismatch for ${id}`);
    if (answer.type === "choice" && question.type === "choice" && !(answer.choice in question.criteria)) {
      throw new DecisionProviderError(`Invalid Jev response: unknown choice for ${id}`);
    }
    answers[id] = answer;
  }
  const usage = object(root.usage, "response.usage");
  return {
    model: root.model,
    answers,
    usage: {
      inputTokens: tokenCount(usage.input_tokens, "response.usage.input_tokens"),
      outputTokens: tokenCount(usage.output_tokens, "response.usage.output_tokens"),
    },
  };
}

function validateRequest(request: DecisionRequest): void {
  if (!request.decisionType.trim()) throw new DecisionProviderError("decisionType is required");
  const entries = Object.entries(request.questions);
  if (!entries.length) throw new DecisionProviderError("At least one decision question is required");
  for (const [id, question] of entries) {
    if (!id.trim() || !question.instructions.trim()) throw new DecisionProviderError(`Question ${id || "<empty>"} is invalid`);
    if (question.type === "choice" && Object.keys(question.criteria).length < 2) {
      throw new DecisionProviderError(`Choice question ${id} requires at least two criteria`);
    }
    if (question.type === "choice" && Object.values(question.criteria).some((criterion) => criterion !== null && typeof criterion !== "string")) {
      throw new DecisionProviderError(`Choice question ${id} criteria must be strings or null`);
    }
    if (question.type === "score" && question.criteria.length < 2) {
      throw new DecisionProviderError(`Score question ${id} requires at least two criteria`);
    }
    if (question.type === "score" && question.criteria.some((criterion) => typeof criterion !== "string" || !criterion.trim())) {
      throw new DecisionProviderError(`Score question ${id} criteria must be non-empty strings`);
    }
  }
}

function summarize(answers: Record<string, DecisionAnswer>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(answers).map(([id, answer]) => [
    id,
    answer.type === "choice" ? answer.choice : answer.type === "score" ? answer.score : answer.noul,
  ])));
}

function meanConfidence(answers: Record<string, DecisionAnswer>): number | undefined {
  const values = Object.values(answers).flatMap((answer) => answer.type === "noul" ? [] : [answer.confidence]);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

export class JevDecisionProvider implements DecisionProvider {
  readonly name = "jev";
  readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: Fetch;
  private readonly recorder: Recorder;

  constructor(options: JevDecisionProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim() || process.env.JEV_API_KEY?.trim() || process.env.TYPESAFE_API_KEY?.trim() || "";
    const baseUrl = (options.baseUrl || process.env.JEV_BASE_URL || "https://api.typesafe.ai").replace(/\/$/, "");
    this.endpoint = `${baseUrl}/v1/systemone`;
    this.model = options.model?.trim() || process.env.JEV_MODEL?.trim() || "jev-latest";
    const configuredTimeout = options.timeoutMs ?? Number(process.env.JEV_TIMEOUT_MS || 20_000);
    this.timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(100, configuredTimeout) : 20_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.recorder = options.recorder ?? recordDecisionCall;
  }

  async evaluate(request: DecisionRequest): Promise<DecisionResponse> {
    validateRequest(request);
    if (!this.apiKey) throw new DecisionProviderError("JEV_API_KEY is not configured");

    const body = JSON.stringify({ state: request.state, model: this.model, questions: request.questions });
    const inputBytes = new TextEncoder().encode(body).byteLength;
    const startedAt = Date.now();
    const audit = request.audit ?? {};
    const baseRecord = {
      provider: this.name,
      model: this.model,
      decisionType: request.decisionType,
      contentId: audit.contentId,
      classificationId: audit.classificationId,
      requestFingerprint: audit.requestFingerprint,
      inputBytes,
      baselineValue: audit.baselineValue,
      shadowMode: audit.shadowMode ?? true,
    };

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        // Provider error bodies may echo request material; retain only the status in telemetry.
        throw new DecisionProviderError(`Jev request failed (${response.status})`, response.status);
      }

      const parsed = parseResponse(await response.json() as unknown, request);
      const result: DecisionResponse = { provider: this.name, ...parsed };
      await this.recorder({
        ...baseRecord,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        durationMs: Date.now() - startedAt,
        ok: true,
        confidence: meanConfidence(result.answers),
        selectedValue: summarize(result.answers),
      }).catch(() => undefined);
      return result;
    } catch (error) {
      await this.recorder({
        ...baseRecord,
        durationMs: Date.now() - startedAt,
        ok: false,
        error: String(error),
      }).catch(() => undefined);
      throw error;
    }
  }
}
