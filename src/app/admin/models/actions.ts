"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { GLOBAL_SCOPE, invalidateBudgetCache } from "@/lib/llm/budget";
import { invalidateLlmConfigCache, providerByName } from "@/lib/llm/config";
import { isLlmTask, isProviderName, type ProviderName } from "@/lib/llm/types";
import { can } from "@/lib/permissions";
import { encryptSecret, hasSecretKey, secretHint } from "@/lib/secrets";

/**
 * Console mutations for model providers, task routing and prices.
 *
 * Nothing here ever returns a stored key. The forms are write-only: an operator can
 * replace a key or clear it, and sees only the last four characters of what is in force.
 */

async function admin() {
  const user = await getSessionUser();
  return user && can(user, "admin.models") ? user : null;
}

function refresh() {
  // The cache is per-process, so this only helps the web app; the scheduler picks the
  // change up when its own snapshot expires. See LLM_CONFIG_CACHE_MS.
  invalidateLlmConfigCache();
  revalidatePath("/admin/models");
}

function text(form: FormData, field: string): string | null {
  const value = form.get(field)?.toString().trim();
  return value ? value : null;
}

export interface ActionResult {
  error?: string;
  ok?: string;
}

export async function saveProvider(_state: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await admin();
  if (!user) return { error: "Not permitted." };
  const name = form.get("provider")?.toString() ?? "";
  if (!isProviderName(name)) return { error: "Unknown provider." };

  const apiKey = text(form, "apiKey");
  const clearKey = form.get("clearKey") === "on";
  if (apiKey && !hasSecretKey()) {
    return { error: "Set CONFIG_ENCRYPTION_KEY (or AUTH_SECRET) in the environment before storing a key here." };
  }

  const data: Record<string, unknown> = {
    baseUrl: text(form, "baseUrl"),
    defaultModel: text(form, "defaultModel"),
    enabled: form.get("enabled") === "on",
  };
  // Three distinct intents: replace the key, remove it, or leave whatever is stored alone.
  // An empty field must mean the last of those, or every unrelated edit would wipe the key.
  if (apiKey) {
    data.apiKeyCipher = encryptSecret(apiKey);
    data.apiKeyHint = secretHint(apiKey);
    data.lastCheckedAt = null;
    data.lastCheckOk = null;
    data.lastCheckError = null;
  } else if (clearKey) {
    data.apiKeyCipher = null;
    data.apiKeyHint = null;
  }

  await prisma.llmProvider.upsert({
    where: { provider: name },
    create: { provider: name, ...data } as never,
    update: data as never,
  });
  await writeAudit({
    actorId: user.id,
    action: apiKey ? "llm.provider.key.set" : clearKey ? "llm.provider.key.clear" : "llm.provider.update",
    targetType: "llmProvider",
    targetId: name,
    // Deliberately no key material, not even the hint: the audit log is read by more
    // people than the settings page is.
    metadata: { baseUrl: data.baseUrl, defaultModel: data.defaultModel, enabled: data.enabled },
  });
  refresh();
  return { ok: apiKey ? "Key stored." : "Saved." };
}

export async function saveRoute(_state: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await admin();
  if (!user) return { error: "Not permitted." };
  const task = form.get("task")?.toString() ?? "";
  if (!isLlmTask(task)) return { error: "Unknown task." };
  const provider = text(form, "provider");
  if (provider && !isProviderName(provider)) return { error: "Unknown provider." };

  const data = { provider, model: text(form, "model"), enabled: form.get("enabled") === "on" };
  await prisma.llmTaskRoute.upsert({ where: { task }, create: { task, ...data }, update: data });
  await writeAudit({ actorId: user.id, action: "llm.route.update", targetType: "llmTaskRoute", targetId: task, metadata: data });
  refresh();
  return { ok: "Saved." };
}

/** A positive number from the form, or null when the field is blank; error on garbage. */
function optionalAmount(form: FormData, field: string): number | null | undefined {
  const raw = form.get(field)?.toString().trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function saveBudget(_state: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await admin();
  if (!user) return { error: "Not permitted." };
  const scope = form.get("scope")?.toString() ?? "";
  if (scope !== GLOBAL_SCOPE && !isLlmTask(scope)) return { error: "Unknown scope." };
  const period = form.get("period")?.toString() === "day" ? "day" : "month";

  const limitTokens = optionalAmount(form, "limitTokens");
  const limitCost = optionalAmount(form, "limitCost");
  if (limitTokens === undefined || limitCost === undefined) {
    return { error: "Ceilings must be positive numbers, or left blank for no cap." };
  }
  // A row with neither ceiling set enforces nothing; clear it rather than store a no-op.
  if (limitTokens === null && limitCost === null) {
    await prisma.llmBudget.deleteMany({ where: { scope } });
    await writeAudit({ actorId: user.id, action: "llm.budget.clear", targetType: "llmBudget", targetId: scope });
    invalidateBudgetCache();
    revalidatePath("/admin/models");
    return { ok: "Cleared." };
  }

  const data = { period, limitTokens: limitTokens ?? null, limitCost: limitCost ?? null, enabled: form.get("enabled") === "on" };
  await prisma.llmBudget.upsert({ where: { scope }, create: { scope, ...data }, update: data });
  await writeAudit({ actorId: user.id, action: "llm.budget.update", targetType: "llmBudget", targetId: scope, metadata: data });
  invalidateBudgetCache();
  revalidatePath("/admin/models");
  return { ok: "Saved." };
}

export async function savePrice(_state: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await admin();
  if (!user) return { error: "Not permitted." };
  const provider = text(form, "provider");
  const model = text(form, "model");
  if (!provider || !isProviderName(provider) || !model) return { error: "Provider and model are both required." };
  const input = Number(form.get("inputPerMTok"));
  const output = Number(form.get("outputPerMTok"));
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
    return { error: "Prices must be non-negative numbers." };
  }
  const currency = (text(form, "currency") ?? "USD").toUpperCase().slice(0, 8);
  const data = { inputPerMTok: input, outputPerMTok: output, currency };
  await prisma.llmModelPrice.upsert({
    where: { provider_model: { provider, model } },
    create: { provider, model, ...data },
    update: data,
  });
  await writeAudit({ actorId: user.id, action: "llm.price.update", targetType: "llmModelPrice", targetId: `${provider}/${model}`, metadata: data });
  revalidatePath("/admin/models");
  return { ok: "Saved." };
}

export async function deletePrice(form: FormData): Promise<void> {
  const user = await admin();
  const id = form.get("id")?.toString();
  if (!user || !id) return;
  const row = await prisma.llmModelPrice.findUnique({ where: { id }, select: { provider: true, model: true } });
  if (!row) return;
  await prisma.llmModelPrice.delete({ where: { id } });
  await writeAudit({ actorId: user.id, action: "llm.price.delete", targetType: "llmModelPrice", targetId: `${row.provider}/${row.model}` });
  revalidatePath("/admin/models");
}

/**
 * Send the smallest possible real request, to prove the key and base URL work.
 *
 * A saved key that is wrong is indistinguishable from a working one until the next
 * pipeline run fails, which may be an hour later and buried in a batch. This is not
 * recorded as pipeline usage — it is a probe, not work.
 */
export async function testProvider(_state: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await admin();
  if (!user) return { error: "Not permitted." };
  const name = form.get("provider")?.toString() ?? "";
  if (!isProviderName(name)) return { error: "Unknown provider." };

  const started = Date.now();
  const result = await probe(name);
  await prisma.llmProvider.upsert({
    where: { provider: name },
    create: { provider: name, lastCheckedAt: new Date(), lastCheckOk: result.ok, lastCheckError: result.error ?? null },
    update: { lastCheckedAt: new Date(), lastCheckOk: result.ok, lastCheckError: result.error ?? null },
  });
  await writeAudit({ actorId: user.id, action: "llm.provider.test", targetType: "llmProvider", targetId: name, metadata: { ok: result.ok } });
  revalidatePath("/admin/models");
  return result.ok
    ? { ok: `Reachable in ${Date.now() - started}ms · ${result.model}` }
    : { error: result.error ?? "Unknown error." };
}

async function probe(name: ProviderName): Promise<{ ok: boolean; model?: string; error?: string }> {
  try {
    const provider = await providerByName(name);
    if (!provider) return { ok: false, error: "No key is configured for this provider, here or in the environment." };
    const response = await provider.complete({
      system: 'Reply with exactly this JSON and nothing else: {"ok":true}',
      user: "ping",
      maxTokens: 32,
    });
    if (!response.text.includes("ok")) return { ok: false, error: `Unexpected reply: ${response.text.slice(0, 120)}` };
    return { ok: true, model: response.model };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 300) };
  }
}
