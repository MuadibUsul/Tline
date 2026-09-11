import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "../db";
import { decryptSecret } from "../secrets";
import { siteUrl } from "../site";

type DraftCard = {
  id: string;
  title: string;
  textEn: string;
  textZh: string;
  routeSnapshot?: string;
  version: number;
  status: string;
  deliveries?: Array<{ status: string; lastError: string | null; mainPostId: string | null; replyPostId: string | null; account: { label: string; externalUsername: string | null } }>;
};

export type FeishuSettings = {
  appId: string;
  appSecret: string;
  encryptKey: string;
  verificationToken: string;
  receiveId: string;
  receiveIdType: string;
  approverOpenIds: string;
  source: "console" | "environment" | "none";
};

let cachedToken: { value: string; expiresAt: number; credentialKey: string } | null = null;

export async function loadFeishuSettings(): Promise<FeishuSettings> {
  const stored = await prisma.socialPlatformCredential.findUnique({ where: { platform: "feishu" } });
  if (stored) {
    let saved: Partial<FeishuSettings> = {};
    try { saved = JSON.parse(decryptSecret(stored.clientSecretCipher) || "{}"); } catch {}
    return {
      appId: stored.clientId,
      appSecret: saved.appSecret || "",
      encryptKey: saved.encryptKey || "",
      verificationToken: saved.verificationToken || "",
      receiveId: saved.receiveId || "",
      receiveIdType: saved.receiveIdType || "open_id",
      approverOpenIds: saved.approverOpenIds || "",
      source: "console",
    };
  }
  const appId = process.env.FEISHU_APP_ID || "";
  return {
    appId,
    appSecret: process.env.FEISHU_APP_SECRET || "",
    encryptKey: process.env.FEISHU_ENCRYPT_KEY || "",
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || "",
    receiveId: process.env.FEISHU_REVIEW_RECEIVE_ID || "",
    receiveIdType: process.env.FEISHU_REVIEW_RECEIVE_ID_TYPE || "open_id",
    approverOpenIds: process.env.FEISHU_APPROVER_OPEN_IDS || "",
    source: appId ? "environment" : "none",
  };
}

async function tenantToken(settings: FeishuSettings): Promise<string> {
  const { appId, appSecret } = settings;
  const credentialKey = createHash("sha256").update(`${appId}\0${appSecret}`).digest("hex");
  if (cachedToken && cachedToken.credentialKey === credentialKey && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (!appId || !appSecret) throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required.");
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }), signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json() as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (!response.ok || body.code || !body.tenant_access_token) throw new Error(`Feishu token failed: ${body.msg || response.status}`);
  cachedToken = { value: body.tenant_access_token, expiresAt: Date.now() + (body.expire || 7200) * 1000, credentialKey };
  return cachedToken.value;
}

function md(value: string) { return value.replace(/([\\`*_[\]<>])/g, "\\$1"); }

export function draftCard(draft: DraftCard) {
  const pending = draft.status === "PENDING_REVIEW";
  let targets: Array<{ label: string; language: string; username?: string | null }> = [];
  try { const parsed = JSON.parse(draft.routeSnapshot || "[]"); if (Array.isArray(parsed)) targets = parsed; } catch {}
  const routeText = targets.map((target) => `${target.label}${target.username ? ` (@${target.username})` : ""} · ${target.language}`).join("、") || "未配置";
  const results = draft.deliveries?.length
    ? `\n\n**发布结果**\n${draft.deliveries.map((item) => `- ${md(item.account.label)}${item.account.externalUsername ? ` (@${md(item.account.externalUsername)})` : ""}: ${item.status} · 主帖${item.mainPostId ? "✅" : "⏳"} · 链接评论${item.replyPostId ? "✅" : "⏳"}${item.lastError ? ` — ${md(item.lastError)}` : ""}`).join("\n")}`
    : "";
  return {
    schema: "2.0",
    header: { template: pending ? "blue" : draft.status === "SUCCEEDED" ? "green" : draft.status === "REJECTED" ? "grey" : "orange", title: { tag: "plain_text", content: `Tlines 发布审核 · ${draft.title}`.slice(0, 100) } },
    body: { elements: [
      { tag: "markdown", content: `**固定发布目标**\n${md(routeText)}\n\n**中文稿（v${draft.version}）**\n${md(draft.textZh)}\n\n**English**\n${md(draft.textEn)}${results}` },
      ...(pending ? [{ tag: "action", actions: [
        { tag: "button", type: "primary", text: { tag: "plain_text", content: "批准并发布" }, value: { action: "approve", draftId: draft.id, version: draft.version } },
        { tag: "button", type: "danger", text: { tag: "plain_text", content: "拒绝" }, value: { action: "reject", draftId: draft.id, version: draft.version } },
        { tag: "button", type: "default", text: { tag: "plain_text", content: "网页改稿" }, url: `${siteUrl()}/admin/social/${draft.id}` },
      ] }] : []),
      { tag: "note", elements: [{ tag: "plain_text", content: pending ? "只有指定审核人可批准；旧版本按钮自动失效。" : `状态：${draft.status}` }] },
    ] },
  };
}

async function feishu(path: string, method: string, body: unknown, settings?: FeishuSettings) {
  const config = settings || await loadFeishuSettings();
  const response = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    method, headers: { authorization: `Bearer ${await tenantToken(config)}`, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  const json = await response.json() as { code?: number; msg?: string; data?: { message_id?: string } };
  if (!response.ok || json.code) throw new Error(`Feishu API failed: ${json.msg || response.status}`);
  return json;
}

export async function sendDraftCard(draft: DraftCard): Promise<string> {
  const settings = await loadFeishuSettings();
  const { receiveId } = settings;
  if (!receiveId) throw new Error("FEISHU_REVIEW_RECEIVE_ID is required.");
  const type = settings.receiveIdType || "open_id";
  const result = await feishu(`/im/v1/messages?receive_id_type=${encodeURIComponent(type)}`, "POST", {
    receive_id: receiveId, msg_type: "interactive", content: JSON.stringify(draftCard(draft)),
  }, settings);
  if (!result.data?.message_id) throw new Error("Feishu did not return a message id.");
  return result.data.message_id;
}

export async function updateDraftCard(messageId: string, draft: DraftCard) {
  await feishu(`/im/v1/messages/${encodeURIComponent(messageId)}`, "PATCH", { content: JSON.stringify(draftCard(draft)) });
}

export async function sendFeishuTestMessage() {
  const settings = await loadFeishuSettings();
  if (!settings.receiveId) throw new Error("FEISHU_REVIEW_RECEIVE_ID is required.");
  await feishu(`/im/v1/messages?receive_id_type=${encodeURIComponent(settings.receiveIdType)}`, "POST", {
    receive_id: settings.receiveId,
    msg_type: "text",
    content: JSON.stringify({ text: "Tlines 飞书审核机器人连接成功。后续发布候选会发送到这里等待审核。" }),
  }, settings);
}

export async function verifyFeishuRequest(body: string, timestamp: string | null, nonce: string | null, signature: string | null): Promise<boolean> {
  const key = (await loadFeishuSettings()).encryptKey;
  if (!key) return process.env.NODE_ENV !== "production";
  if (!timestamp || !nonce || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHash("sha256").update(`${timestamp}${nonce}${key}${body}`).digest("hex");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function allowedFeishuApprover(openId: string | null): Promise<boolean> {
  const allowed = (await loadFeishuSettings()).approverOpenIds.split(",").map((id) => id.trim()).filter(Boolean);
  return Boolean(openId && allowed.includes(openId));
}
