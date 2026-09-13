import { NextRequest, NextResponse } from "next/server";
import { allowedFeishuApprover, decryptFeishuPayload, loadFeishuSettings, verifyFeishuRequest } from "@/lib/social/feishu";
import { decideDraft } from "@/lib/social/pipeline";

export async function POST(request: NextRequest) {
  console.log("[Feishu] webhook received");
  const raw = await request.text();
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }

  let payload = body;
  if (typeof body.encrypt === "string") {
    try {
      const { encryptKey } = await loadFeishuSettings();
      payload = JSON.parse(decryptFeishuPayload(body.encrypt, encryptKey));
    } catch {
      return NextResponse.json({ error: "Invalid encrypted payload." }, { status: 400 });
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

  try {
    if (!await verifyFeishuRequest(raw, request.headers.get("x-lark-request-timestamp"), request.headers.get("x-lark-request-nonce"), request.headers.get("x-lark-signature"))) {
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
    const callbackToken = payload.token || (payload.header as { token?: string } | undefined)?.token;
    const { verificationToken } = await loadFeishuSettings();
    if (verificationToken && callbackToken !== verificationToken) {
      return NextResponse.json({ error: "Invalid verification token." }, { status: 401 });
    }
    const event = (payload.event || payload) as Record<string, unknown>;
    const action = event.action as { value?: Record<string, unknown> } | undefined;
    const operator = event.operator as { operator_id?: { open_id?: string }; open_id?: string } | undefined;
    const openId = operator?.operator_id?.open_id || operator?.open_id || null;
    if (!await allowedFeishuApprover(openId)) return NextResponse.json({ toast: { type: "error", content: "你没有发布权限。" } }, { status: 403 });
    const value = action?.value;
    const decision = value?.action;
    const draftId = value?.draftId;
    const version = Number(value?.version);
    if ((decision !== "approve" && decision !== "reject") || typeof draftId !== "string" || !Number.isInteger(version)) {
      return NextResponse.json({ toast: { type: "error", content: "无效的审核操作。" } }, { status: 400 });
    }
    const result = await decideDraft(draftId, version, decision, `feishu:${openId}`);
    return NextResponse.json({ toast: { type: result.ok ? "success" : "warning", content: result.message } });
  } catch (error) {
    console.error("[Feishu] webhook failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
