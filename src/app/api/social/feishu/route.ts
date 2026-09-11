import { NextRequest, NextResponse } from "next/server";
import { allowedFeishuApprover, verifyFeishuRequest } from "@/lib/social/feishu";
import { decideDraft } from "@/lib/social/pipeline";

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyFeishuRequest(raw, request.headers.get("x-lark-request-timestamp"), request.headers.get("x-lark-request-nonce"), request.headers.get("x-lark-signature"))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (typeof body.challenge === "string") return NextResponse.json({ challenge: body.challenge });
  const callbackToken = body.token || (body.header as { token?: string } | undefined)?.token;
  if (process.env.FEISHU_VERIFICATION_TOKEN && callbackToken !== process.env.FEISHU_VERIFICATION_TOKEN) {
    return NextResponse.json({ error: "Invalid verification token." }, { status: 401 });
  }
  const event = (body.event || body) as Record<string, unknown>;
  const action = event.action as { value?: Record<string, unknown> } | undefined;
  const operator = event.operator as { operator_id?: { open_id?: string }; open_id?: string } | undefined;
  const openId = operator?.operator_id?.open_id || operator?.open_id || null;
  if (!allowedFeishuApprover(openId)) return NextResponse.json({ toast: { type: "error", content: "你没有发布权限。" } }, { status: 403 });
  const value = action?.value;
  const decision = value?.action;
  const draftId = value?.draftId;
  const version = Number(value?.version);
  if ((decision !== "approve" && decision !== "reject") || typeof draftId !== "string" || !Number.isInteger(version)) {
    return NextResponse.json({ toast: { type: "error", content: "无效的审核操作。" } }, { status: 400 });
  }
  const result = await decideDraft(draftId, version, decision, `feishu:${openId}`);
  return NextResponse.json({ toast: { type: result.ok ? "success" : "warning", content: result.message } });
}
