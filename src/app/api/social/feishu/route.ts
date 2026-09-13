import { NextRequest, NextResponse } from "next/server";
import { allowedFeishuApprover, decryptFeishuPayload, loadFeishuSettings, verifyFeishuRequest } from "@/lib/social/feishu";
import { decideDraft, refreshDraftCard } from "@/lib/social/pipeline";

export async function POST(request: NextRequest) {
  console.log("[Feishu] webhook received");
  const raw = await request.text();
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { console.log("[Feishu] invalid JSON"); return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }

  let payload = body;
  if (typeof body.encrypt === "string") {
    try {
      const { encryptKey } = await loadFeishuSettings();
      payload = JSON.parse(decryptFeishuPayload(body.encrypt, encryptKey));
    } catch (error) {
      console.error("[Feishu] decrypt failed:", error instanceof Error ? error.message : String(error));
      return NextResponse.json({ toast: { type: "error", content: "回调消息解密失败：请确认 Encrypt Key 与飞书控制台一致。" } });
    }
  }

  // Feishu URL verification must answer before signature, token, approver and
  // business checks, or the console reports "Challenge code没有返回" when saving.
  if (payload.type === "url_verification" && typeof payload.challenge === "string") {
    console.log("[Feishu] url verification");
    const response = NextResponse.json({ challenge: payload.challenge });
    console.log("[Feishu] challenge returned");
    return response;
  }

  // Feishu card callbacks must always answer HTTP 200: any other status makes the
  // client show the generic "出错了请稍后重试" (200671) instead of our toast.
  try {
    if (!await verifyFeishuRequest(raw, request.headers.get("x-lark-request-timestamp"), request.headers.get("x-lark-request-nonce"), request.headers.get("x-lark-signature"))) {
      console.log("[Feishu] signature rejected");
      return NextResponse.json({ toast: { type: "error", content: "回调签名校验失败，请检查 Encrypt Key 配置。" } });
    }
    const callbackToken = payload.token || (payload.header as { token?: string } | undefined)?.token;
    const { verificationToken } = await loadFeishuSettings();
    if (verificationToken && callbackToken !== verificationToken) {
      console.log("[Feishu] token mismatch");
      return NextResponse.json({ toast: { type: "error", content: "回调 Verification Token 校验失败。" } });
    }
    const event = (payload.event || payload) as Record<string, unknown>;
    const action = event.action as { value?: Record<string, unknown> } | undefined;
    const operator = event.operator as { operator_id?: { open_id?: string }; open_id?: string } | undefined;
    const openId = operator?.operator_id?.open_id || operator?.open_id || null;
    if (!await allowedFeishuApprover(openId)) {
      console.log("[Feishu] approver denied");
      return NextResponse.json({ toast: { type: "error", content: "你没有发布权限。" } });
    }
    const value = action?.value;
    const decision = value?.action;
    const draftId = value?.draftId;
    const version = Number(value?.version);
    if ((decision !== "approve" && decision !== "reject") || typeof draftId !== "string" || !Number.isInteger(version)) {
      console.log("[Feishu] invalid action");
      return NextResponse.json({ toast: { type: "error", content: "无效的审核操作。" } });
    }
    const result = await decideDraft(draftId, version, decision, `feishu:${openId}`);
    // The card refresh calls the Feishu API and must not eat into the callback's
    // 3-second deadline (a slow refresh is exactly the 200341 the client showed).
    const response = NextResponse.json({ toast: { type: result.ok ? "success" : "warning", content: result.message } });
    if (result.ok) void refreshDraftCard(draftId).catch(() => {});
    return response;
  } catch (error) {
    console.error("[Feishu] webhook failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ toast: { type: "error", content: "服务器处理失败，请稍后重试。" } });
  }
}
