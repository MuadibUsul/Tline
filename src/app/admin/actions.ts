"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { can, type PermissionAction } from "@/lib/permissions";
import { isRetryKind, queueRetry } from "@/lib/contentRetry";
import { API_SCOPES, generateToken, hashToken, tokenPrefix } from "@/lib/apiKeys";

/** The actor, if they hold `action`; null otherwise. Every mutation names its own gate. */
async function authorized(action: PermissionAction) {
  const user = await getSessionUser();
  return user && can(user, action) ? user : null;
}

export async function setSourceMonitoring(formData: FormData) {
  const user = await authorized("admin.sources");
  const id = formData.get("id")?.toString();
  const enabled = formData.get("enabled") === "true";
  if (!user || !id) return;
  const source = await prisma.institution.findUnique({ where: { id }, select: { id: true, name: true, crawlPolicy: true } });
  if (!source) return;
  await prisma.institution.update({
    where: { id },
    data: {
      monitoringEnabled: enabled,
      ...(enabled ? { consecutiveFailures: 0, nextCrawlAt: null, lastCrawlStatus: "queued", lastCrawlMessage: "Resumed by operations." } : {}),
      ...(!enabled ? { lastCrawlStatus: "paused", lastCrawlMessage: "Paused by operations." } : {}),
    },
  });
  await writeAudit({ actorId: user.id, action: enabled ? "source.monitoring.resume" : "source.monitoring.pause", targetType: "institution", targetId: id, metadata: { name: source.name, crawlPolicy: source.crawlPolicy } });
  revalidatePath("/admin/sources");
}

export async function queueSourceRetry(formData: FormData) {
  const user = await authorized("admin.sources");
  const id = formData.get("id")?.toString();
  if (!user || !id) return;
  const source = await prisma.institution.findUnique({ where: { id }, select: { id: true, name: true, crawlPolicy: true } });
  if (!source || !["allowed", "delayed"].includes(source.crawlPolicy)) return;
  await prisma.institution.update({
    where: { id },
    data: { monitoringEnabled: true, consecutiveFailures: 0, nextCrawlAt: null, lastCrawlAt: null, lastCrawlStatus: "queued", lastCrawlMessage: "Queued for the next scheduler pass." },
  });
  await writeAudit({ actorId: user.id, action: "source.retry.queue", targetType: "institution", targetId: id, metadata: { name: source.name } });
  revalidatePath("/admin/sources");
}

export async function queueContentRetry(formData: FormData) {
  const user = await authorized("admin.review");
  const articleId = formData.get("articleId")?.toString();
  const kind = formData.get("kind")?.toString();
  if (!user || !articleId || !kind || !isRetryKind(kind)) return;
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { id: true, title: true } });
  if (!article) return;
  const retry = await queueRetry(articleId, kind, user.id);
  await writeAudit({
    actorId: user.id,
    action: "content.retry.queue",
    targetType: "article",
    targetId: articleId,
    metadata: { kind, title: article.title, scoreBefore: retry.scoreBefore },
  });
  revalidatePath(`/research/${articleId}`);
  revalidatePath("/admin/review");
}

export interface CreateKeyResult {
  error?: string;
  /** Present exactly once, immediately after creation; never retrievable again. */
  token?: string;
  name?: string;
}

export async function createApiKey(_previous: CreateKeyResult, formData: FormData): Promise<CreateKeyResult> {
  const user = await authorized("admin.api");
  if (!user) return { error: "Not authorised." };

  const name = formData.get("name")?.toString().trim() ?? "";
  if (!name) return { error: "Give the key a name so it can be recognised later." };

  const requested = formData.getAll("scopes").map(String);
  const scopes = API_SCOPES.filter((scope) => requested.includes(scope));
  if (scopes.length === 0) return { error: "Select at least one scope." };

  const rateLimit = Number(formData.get("rateLimit") ?? 60);
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 6000) {
    return { error: "Rate limit must be between 1 and 6000 requests per minute." };
  }

  const token = generateToken();
  const key = await prisma.apiKey.create({
    data: {
      name,
      prefix: tokenPrefix(token),
      tokenHash: hashToken(token),
      scopes: JSON.stringify(scopes),
      rateLimit,
      createdById: user.id,
    },
  });
  // The secret is deliberately absent from the audit record: it is returned to the
  // browser once and never stored anywhere in readable form.
  await writeAudit({ actorId: user.id, action: "apikey.create", targetType: "apiKey", targetId: key.id, metadata: { name, scopes, rateLimit } });
  revalidatePath("/admin/api");
  return { token, name };
}

export async function revokeApiKey(formData: FormData) {
  const user = await authorized("admin.api");
  const id = formData.get("id")?.toString();
  if (!user || !id) return;
  const key = await prisma.apiKey.findUnique({ where: { id }, select: { id: true, name: true, revokedAt: true } });
  if (!key || key.revokedAt) return;
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await writeAudit({ actorId: user.id, action: "apikey.revoke", targetType: "apiKey", targetId: id, metadata: { name: key.name } });
  revalidatePath("/admin/api");
}

/**
 * Replaces a key with a new secret, keeping its name, scopes and limit.
 *
 * The old key is revoked rather than deleted, so its past usage stays attributable, and
 * the new secret is returned once through the action result exactly as a fresh key is.
 * Rotation without this is "revoke, then retype the configuration from memory", which is
 * how a key ends up with wider scopes than the one it replaced.
 */
export async function rotateApiKey(_previous: CreateKeyResult, formData: FormData): Promise<CreateKeyResult> {
  const user = await authorized("admin.api");
  if (!user) return { error: "Not authorised." };
  const id = formData.get("id")?.toString();
  if (!id) return { error: "Missing key." };

  const existing = await prisma.apiKey.findUnique({ where: { id } });
  if (!existing) return { error: "That key no longer exists." };
  if (existing.revokedAt) return { error: "That key is already revoked; issue a new one instead." };

  const token = generateToken();
  const [, created] = await prisma.$transaction([
    prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } }),
    prisma.apiKey.create({
      data: {
        name: existing.name,
        prefix: tokenPrefix(token),
        tokenHash: hashToken(token),
        scopes: existing.scopes,
        rateLimit: existing.rateLimit,
        createdById: user.id,
      },
    }),
  ]);
  await writeAudit({ actorId: user.id, action: "apikey.rotate", targetType: "apiKey", targetId: created.id, metadata: { name: existing.name, replaced: id } });
  revalidatePath("/admin/api");
  return { token, name: existing.name };
}

/** Raises or lowers what one caller may spend per minute, without reissuing the secret. */
export async function updateApiKeyLimit(formData: FormData) {
  const user = await authorized("admin.api");
  const id = formData.get("id")?.toString();
  const rateLimit = Number(formData.get("rateLimit"));
  if (!user || !id) return;
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 6000) return;

  const key = await prisma.apiKey.findUnique({ where: { id }, select: { name: true, rateLimit: true, revokedAt: true } });
  if (!key || key.revokedAt || key.rateLimit === rateLimit) return;
  await prisma.apiKey.update({ where: { id }, data: { rateLimit } });
  await writeAudit({ actorId: user.id, action: "apikey.limit.set", targetType: "apiKey", targetId: id, metadata: { name: key.name, from: key.rateLimit, to: rateLimit } });
  revalidatePath("/admin/api");
}
