import { prisma } from "../db";
import { decryptSecret } from "../secrets";
import { createProvider, envApiKey, getLLMProvider, withUsageRecording, type ProviderConfig } from "./provider";
import { isProviderName, PROVIDER_NAMES, type LlmTask, type LLMProvider, type ProviderName } from "./types";

/**
 * Where a task's provider and model come from, in order of precedence:
 *
 *   1. the task's row in LlmTaskRoute, set from the console;
 *   2. the provider's row in LlmProvider (key, base URL, default model);
 *   3. the environment variables that were the only mechanism before the console existed.
 *
 * The environment is kept as the floor rather than migrated away from, so an existing
 * deployment behaves identically until somebody actually saves something in the console,
 * and so a database that is unreachable cannot take the whole pipeline down with it.
 */

/** Per-task environment preference, preserved from before routes were configurable. */
function envPreference(task: LlmTask): string | undefined {
  switch (task) {
    case "translation":
    case "retitle":
      return process.env.TRANSLATION_PROVIDER ?? process.env.LLM_PROVIDER;
    case "translation_review":
      return process.env.TRANSLATION_REVIEW_PROVIDER ?? process.env.TRANSLATION_PROVIDER ?? process.env.LLM_PROVIDER;
    case "forecast":
    case "release_analysis":
      return process.env.FORECAST_PROVIDER ?? process.env.TRANSLATION_PROVIDER ?? process.env.LLM_PROVIDER;
    case "analysis":
    case "policy":
      return process.env.LLM_PROVIDER;
  }
}

export interface ProviderRow {
  provider: string;
  apiKeyCipher: string | null;
  baseUrl: string | null;
  defaultModel: string | null;
  enabled: boolean;
}

export interface RouteRow {
  task: string;
  provider: string | null;
  model: string | null;
  enabled: boolean;
}

interface Snapshot {
  loadedAt: number;
  providers: Map<string, ProviderRow>;
  routes: Map<string, RouteRow>;
}

/**
 * Short-lived cache.
 *
 * A model call happens hundreds of times an hour across several processes, and none of
 * them should read two config tables first. The window is short because the scheduler and
 * the web app are separate processes: saving in the console can only invalidate its own
 * cache, so everything else has to notice by expiry.
 */
const CACHE_TTL_MS = Math.max(0, Number(process.env.LLM_CONFIG_CACHE_MS || 30_000));
let cache: Snapshot | null = null;

export function invalidateLlmConfigCache(): void {
  cache = null;
}

async function snapshot(): Promise<Snapshot> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  try {
    const [providers, routes] = await Promise.all([
      prisma.llmProvider.findMany({ select: { provider: true, apiKeyCipher: true, baseUrl: true, defaultModel: true, enabled: true } }),
      prisma.llmTaskRoute.findMany({ select: { task: true, provider: true, model: true, enabled: true } }),
    ]);
    cache = {
      loadedAt: Date.now(),
      providers: new Map(providers.map((row) => [row.provider, row])),
      routes: new Map(routes.map((row) => [row.task, row])),
    };
  } catch (error) {
    // An unreachable or un-migrated database must not stop the pipeline: fall through to
    // the environment, which is what ran it before any of this existed.
    console.error(JSON.stringify({ event: "llm.config.load.failed", error: String(error).slice(0, 300) }));
    cache = { loadedAt: Date.now(), providers: new Map(), routes: new Map() };
  }
  return cache;
}

/** The key in force for a provider: the console's, else the environment's. */
export function apiKeyFor(name: ProviderName, row: ProviderRow | undefined): string | undefined {
  if (row && row.enabled === false) return undefined;
  const stored = decryptSecret(row?.apiKeyCipher);
  return stored ?? envApiKey(name);
}

function configFor(row: ProviderRow | undefined, apiKey: string, model: string | null | undefined): ProviderConfig {
  return {
    apiKey,
    model: model ?? row?.defaultModel ?? undefined,
    baseUrl: row?.baseUrl ?? undefined,
  };
}

export interface ResolvedProvider {
  provider: LLMProvider;
  source: "console" | "environment";
}

/**
 * Resolve the provider for one task, wrapped so its usage is recorded.
 *
 * Returns null when the task is switched off, or when nothing anywhere holds a key — the
 * callers each decide whether that is fatal (translation) or simply means the step is
 * skipped (the independent review).
 */
export async function resolveLLMProvider(task: LlmTask): Promise<LLMProvider | null> {
  const resolved = await resolveWithSource(task);
  return resolved ? withUsageRecording(resolved.provider, task) : null;
}

/**
 * One switch that stops every model call, whatever the per-task routes say.
 *
 * The console can already disable each task individually, which is the right control when
 * the question is "should this stage run". This answers a different one — "stop spending
 * now" — and it is read from the environment rather than the database on purpose: the
 * reason to reach for it is usually that something is wrong, and it should not depend on
 * a database read or a cache expiry to take effect.
 */
export function isLlmDisabled(): boolean {
  const value = process.env.LLM_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export async function resolveWithSource(task: LlmTask): Promise<ResolvedProvider | null> {
  if (isLlmDisabled()) return null;
  const { providers, routes } = await snapshot();
  const route = routes.get(task);
  if (route && !route.enabled) return null;

  const preferred = (route?.provider ?? envPreference(task))?.toLowerCase();
  const order = preferred && isProviderName(preferred)
    ? [preferred, ...PROVIDER_NAMES.filter((name) => name !== preferred)]
    : [...PROVIDER_NAMES];

  for (const name of order) {
    const row = providers.get(name);
    const apiKey = apiKeyFor(name, row);
    if (!apiKey) continue;
    // The route's model applies only to the provider the route actually named; falling
    // back to a different vendor must not carry the first one's model name with it.
    const model = name === preferred ? route?.model : null;
    return {
      provider: createProvider(name, configFor(row, apiKey, model)),
      source: decryptSecret(row?.apiKeyCipher) ? "console" : "environment",
    };
  }
  return null;
}

/**
 * Whether anything at all is configured, for the CLIs that refuse to start without it.
 * Cheap and side-effect free: no provider is constructed and no call is made.
 */
export async function anyProviderConfigured(): Promise<boolean> {
  if (isLlmDisabled()) return false;
  const { providers } = await snapshot();
  if (PROVIDER_NAMES.some((name) => apiKeyFor(name, providers.get(name)))) return true;
  return getLLMProvider() !== null;
}

/**
 * One named provider, configured from the console row with the environment as fallback.
 *
 * Used by the console's connection test and by the provider-comparison CLI, both of which
 * name the provider themselves rather than asking which one a task routes to. Returns null
 * when nothing holds a key for it. Not wrapped in usage recording: a connection probe is
 * not pipeline work, and counting it would pollute the task figures.
 */
export async function providerByName(name: ProviderName, overrides: ProviderConfig = {}): Promise<LLMProvider | null> {
  // Not gated by isLlmDisabled: the console's connection test exists to answer whether a
  // key works, which is a question an operator may well be asking precisely because
  // everything is switched off.
  const { providers } = await snapshot();
  const row = providers.get(name);
  const apiKey = overrides.apiKey ?? apiKeyFor(name, row);
  if (!apiKey) return null;
  return createProvider(name, {
    apiKey,
    model: overrides.model ?? row?.defaultModel ?? undefined,
    baseUrl: overrides.baseUrl ?? row?.baseUrl ?? undefined,
  });
}
