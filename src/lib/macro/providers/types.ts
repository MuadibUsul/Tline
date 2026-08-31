import type { MacroProvider } from "../types";

export type FetchLike = typeof fetch;

export interface ProviderOptions {
  apiKey?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  minIntervalMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export type ProviderErrorCode = "CONFIG" | "TIMEOUT" | "NETWORK" | "HTTP" | "RESPONSE";

export class MacroProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: ProviderErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "MacroProviderError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Small shared HTTP boundary: timeout, bounded retry, per-provider pacing, and secret-safe errors. */
export function createJsonClient(provider: string, options: ProviderOptions = {}) {
  const request = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retries = options.retries ?? 2;
  const minIntervalMs = options.minIntervalMs ?? 250;
  let lastStartedAt = 0;

  return async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = lastStartedAt + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastStartedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await request(url, {
          ...init,
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "user-agent": "TlineMacroIntelligence/0.1 (+official economic data client)",
            ...init.headers,
          },
        });
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          if (retryable && attempt < retries) {
            const retryAfter = Number(response.headers.get("retry-after"));
            await sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 5_000) : 250 * 2 ** attempt);
            continue;
          }
          throw new MacroProviderError(provider, "HTTP", `${provider} request failed with HTTP ${response.status}.`, response.status, retryable);
        }
        try {
          return await response.json() as T;
        } catch {
          throw new MacroProviderError(provider, "RESPONSE", `${provider} returned invalid JSON.`);
        }
      } catch (error) {
        if (error instanceof MacroProviderError) throw error;
        const timedOut = controller.signal.aborted;
        if (attempt < retries) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
        throw new MacroProviderError(
          provider,
          timedOut ? "TIMEOUT" : "NETWORK",
          `${provider} request ${timedOut ? "timed out" : "failed"}.`,
          null,
          true,
        );
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export function requireApiKey(provider: string, value: string | undefined): string {
  if (!value) throw new MacroProviderError(provider, "CONFIG", `${provider.toUpperCase()}_API_KEY is required.`);
  return value;
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export type OfficialMacroProvider = MacroProvider;
