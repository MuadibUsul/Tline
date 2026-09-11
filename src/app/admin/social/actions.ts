"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { validatePost } from "@/lib/social/content";
import { decideDraft, refreshDraftCard, regenerateDraft } from "@/lib/social/pipeline";
import { encryptSecret, hasSecretKey, secretHint } from "@/lib/secrets";

async function admin() { const user = await getSessionUser(); return user && can(user, "admin.social") ? user : null; }
function refresh(id?: string) { revalidatePath("/admin/social"); if (id) revalidatePath(`/admin/social/${id}`); }

export interface SocialActionResult { error?: string; ok?: string; }

export async function saveXAppSettings(_state: SocialActionResult, form: FormData): Promise<SocialActionResult> {
  const user = await admin();
  if (!user) return { error: "无权执行此操作。" };
  const clientId = form.get("clientId")?.toString().trim() || "";
  const clientSecret = form.get("clientSecret")?.toString().trim() || "";
  const clearSecret = form.get("clearSecret") === "on";
  if (!clientId) return { error: "请填写 X Client ID。" };
  if (clientId.length > 500 || clientSecret.length > 1000) return { error: "X 应用凭据长度不正确。" };
  if (clientSecret && !hasSecretKey()) return { error: "服务器尚未配置密钥加密能力。" };

  const data = {
    clientId,
    ...(clientSecret ? { clientSecretCipher: encryptSecret(clientSecret), clientSecretHint: secretHint(clientSecret) }
      : clearSecret ? { clientSecretCipher: null, clientSecretHint: null } : {}),
  };
  await prisma.socialPlatformCredential.upsert({ where: { platform: "x" }, create: { platform: "x", ...data }, update: data });
  await writeAudit({ actorId: user.id, action: "social.x_app.update", targetType: "socialPlatformCredential", targetId: "x", metadata: { clientIdUpdated: true, clientSecretUpdated: Boolean(clientSecret), clientSecretCleared: clearSecret } });
  refresh();
  return { ok: "X 应用配置已保存，现在可以连接账号。" };
}

export async function createSocialAccount(form: FormData) {
  const user = await admin();
  const label = form.get("label")?.toString().trim();
  const language = form.get("language") === "zh-CN" ? "zh-CN" : "en";
  if (!user || !label || await prisma.socialAccount.count({ where: { platform: "x" } }) >= 2) return;
  const account = await prisma.socialAccount.create({ data: { label: label.slice(0, 80), language } });
  await writeAudit({ actorId: user.id, action: "social.account.create", targetType: "socialAccount", targetId: account.id, metadata: { label, language } });
  refresh();
}

export async function saveSocialAccount(form: FormData) {
  const user = await admin();
  const id = form.get("id")?.toString();
  const label = form.get("label")?.toString().trim();
  if (!user || !id || !label) return;
  const language = form.get("language") === "zh-CN" ? "zh-CN" : "en";
  const current = await prisma.socialAccount.findUnique({ where: { id } });
  if (!current) return;
  const enabled = form.get("enabled") === "on" && Boolean(current.accessTokenCipher);
  await prisma.$transaction([
    prisma.socialAccount.update({ where: { id }, data: { label: label.slice(0, 80), language, enabled } }),
    ...(["research", "macro"] as const).map((sourceKind) => form.get(sourceKind) === "on"
      ? prisma.socialRoute.upsert({ where: { sourceKind_accountId: { sourceKind, accountId: id } }, create: { sourceKind, accountId: id }, update: { enabled: true } })
      : prisma.socialRoute.updateMany({ where: { sourceKind, accountId: id }, data: { enabled: false } })),
  ]);
  await writeAudit({ actorId: user.id, action: "social.account.update", targetType: "socialAccount", targetId: id, metadata: { label, language, enabled } });
  refresh();
}

export async function disconnectSocialAccount(form: FormData) {
  const user = await admin();
  const id = form.get("id")?.toString();
  if (!user || !id) return;
  const account = await prisma.socialAccount.findUnique({ where: { id } });
  if (!account) return;
  await prisma.socialAccount.update({ where: { id }, data: { externalAccountId: null, externalUsername: null, accessTokenCipher: null, refreshTokenCipher: null, tokenExpiresAt: null, enabled: false, lastError: null } });
  await writeAudit({ actorId: user.id, action: "social.account.disconnect", targetType: "socialAccount", targetId: id });
  refresh();
}

export async function saveSocialDraft(form: FormData) {
  const user = await admin();
  const id = form.get("id")?.toString();
  if (!user || !id) return;
  const textEn = (form.get("textEn")?.toString() || "").trim();
  const textZh = (form.get("textZh")?.toString() || "").trim();
  if (validatePost(textEn) || validatePost(textZh)) return;
  const changed = await prisma.socialDraft.updateMany({ where: { id, status: "PENDING_REVIEW" }, data: { textEn, textZh, version: { increment: 1 } } });
  if (!changed.count) return;
  await writeAudit({ actorId: user.id, action: "social.draft.edit", targetType: "socialDraft", targetId: id });
  await refreshDraftCard(id);
  refresh(id);
}

export async function decideSocialDraft(form: FormData) {
  const user = await admin();
  const id = form.get("id")?.toString();
  const version = Number(form.get("version"));
  const decision = form.get("decision") === "reject" ? "reject" : "approve";
  if (!user || !id || !Number.isInteger(version)) return;
  await decideDraft(id, version, decision, user.id);
  refresh(id);
}

export async function regenerateSocialDraft(form: FormData) {
  const user = await admin();
  const id = form.get("id")?.toString();
  if (!user || !id || !await regenerateDraft(id)) return;
  await writeAudit({ actorId: user.id, action: "social.draft.regenerate", targetType: "socialDraft", targetId: id });
  refresh(id);
}

export async function retrySocialDelivery(form: FormData) {
  const user = await admin();
  const id = form.get("id")?.toString();
  if (!user || !id) return;
  const delivery = await prisma.socialDelivery.findUnique({ where: { id } });
  if (!delivery || !["FAILED", "RETRY"].includes(delivery.status)) return;
  await prisma.socialDelivery.update({ where: { id }, data: { status: "RETRY", nextAttemptAt: new Date(), lastError: null } });
  await prisma.socialDraft.update({ where: { id: delivery.draftId }, data: { status: "PUBLISHING" } });
  await writeAudit({ actorId: user.id, action: "social.delivery.retry", targetType: "socialDelivery", targetId: id });
  refresh(delivery.draftId);
}

export async function retryFeishuNotification(form: FormData) {
  const user = await admin();
  const id = form.get("id")?.toString();
  if (!user || !id) return;
  await prisma.socialDraft.updateMany({ where: { id, status: "PENDING_REVIEW", feishuMessageId: null }, data: { notifyAttempts: 0, notifyError: null } });
  refresh(id);
}
