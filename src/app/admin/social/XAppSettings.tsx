"use client";

import { useActionState } from "react";
import { saveXAppSettings, type SocialActionResult } from "./actions";

export default function XAppSettings({ clientId, secretHint, callbackUrl, source }: { clientId: string; secretHint: string | null; callbackUrl: string; source: "console" | "environment" | "none" }) {
  const [state, action, pending] = useActionState<SocialActionResult, FormData>(saveXAppSettings, {});
  return <section className="blk">
    <div className="section-t"><span>X 应用配置</span><span className={`chip ${source === "none" ? "gray" : "acc"}`}>{source === "console" ? "后台配置" : source === "environment" ? "服务器配置" : "未配置"}</span></div>
    <form action={action} className="llm-form">
      <label><span>Client ID</span><input name="clientId" defaultValue={clientId} required autoComplete="off" spellCheck={false}/></label>
      <label><span>Client Secret</span><input name="clientSecret" type="password" autoComplete="new-password" spellCheck={false} placeholder={secretHint ? `已保存 ${secretHint}；留空表示不修改` : "从 X Developer Portal 复制"}/></label>
      {secretHint && <label className="llm-check"><input type="checkbox" name="clearSecret"/><span>清除已保存的 Client Secret</span></label>}
      <p className="admin-hint">请在 X Developer Portal 中把 OAuth 2.0 回调地址设为：<code>{callbackUrl}</code>。密钥保存后不会再次显示原文。</p>
      <div className="llm-form-row"><button className="minibtn p" type="submit" disabled={pending}>{pending ? "保存中…" : "保存 X 应用配置"}</button>{state.error && <span className="llm-msg bad" role="alert">{state.error}</span>}{state.ok && <span className="llm-msg good" role="status">{state.ok}</span>}</div>
    </form>
  </section>;
}
