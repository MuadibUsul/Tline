"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { can, type PermissionAction } from "@/lib/permissions";
import { isRetryKind, queueRetry } from "@/lib/contentRetry";
import { API_SCOPES, generateToken, hashToken, tokenPrefix } from "@/lib/apiKeys";
import { taxonomy } from "@/lib/classification/taxonomy";

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
      ...(enabled ? { consecutiveFailures: 0, nextCrawlAt: null, lastCrawlStatus: "queued", lastCrawlMessage: "已由后台恢复监控。" } : {}),
      ...(!enabled ? { lastCrawlStatus: "paused", lastCrawlMessage: "已由后台暂停监控。" } : {}),
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
    data: { monitoringEnabled: true, consecutiveFailures: 0, nextCrawlAt: null, lastCrawlAt: null, lastCrawlStatus: "queued", lastCrawlMessage: "已加入下一轮调度。" },
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

export async function resolveContentReview(formData: FormData) {
  const user = await authorized("admin.review");
  const articleId = formData.get("articleId")?.toString();
  const kind = formData.get("kind")?.toString();
  if (!user || !articleId || !kind || !isRetryKind(kind)) return;
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { title: true } });
  if (!article) return;
  if (kind === "analysis") {
    await prisma.analysis.updateMany({ where: { articleId, reviewStatus: "needs_review" }, data: { reviewStatus: "ok" } });
  } else {
    await prisma.articleTranslation.updateMany({ where: { articleId, status: "needs_review" }, data: { status: "reviewed" } });
  }
  await writeAudit({ actorId: user.id, action: "content.review.resolve", targetType: "article", targetId: articleId, metadata: { kind, title: article.title } });
  revalidatePath(`/research/${articleId}`);
  revalidatePath("/admin/review");
}

export async function approveClassificationReview(formData: FormData) {
  const user = await authorized("admin.review");
  const id = formData.get("classificationId")?.toString();
  if (!user || !id) return;
  const classification = await prisma.contentClassification.findUnique({
    where: { id },
    select: { id: true, articleId: true, status: true, source: true, confidence: true },
  });
  if (!classification || classification.status !== "REVIEW") return;
  await prisma.contentClassification.update({ where: { id }, data: { status: "CLASSIFIED" } });
  await writeAudit({
    actorId: user.id,
    action: "classification.review.approve",
    targetType: "contentClassification",
    targetId: id,
    metadata: { source: classification.source, confidence: classification.confidence, articleId: classification.articleId },
  });
  if (classification.articleId) revalidatePath(`/research/${classification.articleId}`);
  revalidatePath("/admin/review");
}

const selected = (formData: FormData, name: string) => formData.getAll(name).map(String).map((value) => value.trim()).filter(Boolean);

export async function correctClassificationReview(formData: FormData) {
  const user = await authorized("admin.review");
  const id = formData.get("classificationId")?.toString();
  if (!user || !id) return;
  const existing = await prisma.contentClassification.findUnique({
    where: { id },
    include: { jurisdictions: true, institutions: true, topics: true, assets: { include: { asset: true } }, assetClasses: true, events: true },
  });
  if (!existing) return;

  const jurisdictionKeys = new Set(taxonomy.jurisdictions.map((item) => item.key));
  const institutionKeys = new Set(taxonomy.institutions.map((item) => item.key));
  const topicKeys = new Set(taxonomy.topics.map((item) => item.key));
  const eventKeys = new Set(taxonomy.events.map((item) => item.key));
  const assetClassKeys = new Set(taxonomy.assetClasses.map((item) => item.key));
  const contentTypes = new Set(taxonomy.contentTypes.map((item) => item.key));
  const primaryJurisdiction = jurisdictionKeys.has(String(formData.get("primaryJurisdiction"))) ? String(formData.get("primaryJurisdiction")) : null;
  const relatedJurisdictions = selected(formData, "relatedJurisdictions").filter((key) => jurisdictionKeys.has(key) && key !== primaryJurisdiction);
  const requestedState = String(formData.get("jurisdictionState") ?? "UNKNOWN");
  const nonKnownStates = new Set(["GLOBAL", "UNKNOWN", "NONE", "NOT_APPLICABLE"]);
  const jurisdictionState = primaryJurisdiction ? "KNOWN" : relatedJurisdictions.length >= 2 ? "MULTIPLE" : nonKnownStates.has(requestedState) ? requestedState : "UNKNOWN";
  const primaryInstitution = institutionKeys.has(String(formData.get("primaryInstitution"))) ? String(formData.get("primaryInstitution")) : null;
  const relatedInstitutions = selected(formData, "relatedInstitutions").filter((key) => institutionKeys.has(key) && key !== primaryInstitution);
  const topics = selected(formData, "topics").filter((key) => topicKeys.has(key));
  const events = selected(formData, "events").filter((key) => eventKeys.has(key));
  const assetClasses = selected(formData, "assetClasses").filter((key) => assetClassKeys.has(key));
  const contentType = contentTypes.has(String(formData.get("contentType"))) ? String(formData.get("contentType")) : "UNKNOWN";
  const requestedTickers = [...new Set(String(formData.get("assets") ?? "").split(/[\s,]+/).map((value) => value.trim().toUpperCase()).filter(Boolean))];
  const assets = requestedTickers.length ? await prisma.asset.findMany({ where: { ticker: { in: requestedTickers } }, select: { id: true, ticker: true } }) : [];

  const before = {
    jurisdictionState: existing.jurisdictionState,
    jurisdictions: existing.jurisdictions.map((item) => [item.jurisdictionKey, item.role]),
    institutions: existing.institutions.map((item) => [item.institutionKey, item.role]),
    topics: existing.topics.map((item) => item.topicKey), assets: existing.assets.map((item) => item.asset.ticker),
    assetClasses: existing.assetClasses.map((item) => item.assetClassKey), events: existing.events.map((item) => item.eventKey),
    contentType: existing.contentType, source: existing.source,
  };
  await prisma.contentClassification.update({
    where: { id },
    data: {
      jurisdictionState, contentType, confidence: 1, source: "MANUAL", status: "CLASSIFIED",
      classifier: "admin", classifierVersion: "manual-v1", classifiedAt: new Date(),
      jurisdictions: { deleteMany: {}, create: [
        ...(primaryJurisdiction ? [{ jurisdictionKey: primaryJurisdiction, role: "PRIMARY" }] : []),
        ...relatedJurisdictions.map((jurisdictionKey) => ({ jurisdictionKey, role: "RELATED" })),
      ] },
      institutions: { deleteMany: {}, create: [
        ...(primaryInstitution ? [{ institutionKey: primaryInstitution, role: "PRIMARY", confidence: 1 }] : []),
        ...relatedInstitutions.map((institutionKey) => ({ institutionKey, role: "RELATED", confidence: 1 })),
      ] },
      topics: { deleteMany: {}, create: topics.map((topicKey) => ({ topicKey, confidence: 1 })) },
      events: { deleteMany: {}, create: events.map((eventKey) => ({ eventKey, confidence: 1 })) },
      assetClasses: { deleteMany: {}, create: assetClasses.map((assetClassKey) => ({ assetClassKey, confidence: 1 })) },
      assets: { deleteMany: {}, create: assets.map((asset) => ({ assetId: asset.id, confidence: 1 })) },
    },
  });
  await writeAudit({
    actorId: user.id, action: "classification.review.correct", targetType: "contentClassification", targetId: id,
    metadata: { before, after: { jurisdictionState, primaryJurisdiction, relatedJurisdictions, primaryInstitution, relatedInstitutions, topics, assets: assets.map((item) => item.ticker), assetClasses, events, contentType }, articleId: existing.articleId },
  });
  if (existing.articleId) revalidatePath(`/research/${existing.articleId}`);
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
  if (!user) return { error: "无权执行此操作。" };

  const name = formData.get("name")?.toString().trim() ?? "";
  if (!name) return { error: "请填写密钥名称，以便日后识别。" };

  const requested = formData.getAll("scopes").map(String);
  const scopes = API_SCOPES.filter((scope) => requested.includes(scope));
  if (scopes.length === 0) return { error: "请至少选择一个权限范围。" };

  const rateLimit = Number(formData.get("rateLimit") ?? 60);
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 6000) {
    return { error: "每分钟请求上限必须在 1 到 6000 之间。" };
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
  if (!user) return { error: "无权执行此操作。" };
  const id = formData.get("id")?.toString();
  if (!id) return { error: "缺少密钥。" };

  const existing = await prisma.apiKey.findUnique({ where: { id } });
  if (!existing) return { error: "该密钥已不存在。" };
  if (existing.revokedAt) return { error: "该密钥已被吊销，请改为签发新密钥。" };

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
