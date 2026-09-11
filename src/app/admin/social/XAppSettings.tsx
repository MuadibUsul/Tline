"use client";

import { useActionState } from "react";
import { saveXAppSettings, type SocialActionResult } from "./actions";

export default function XAppSettings({ clientId, secretHint, callbackUrl, source }: { clientId: string; secretHint: string | null; callbackUrl: string; source: "console" | "environment" | "none" }) {
  const [state, action, pending] = useActionState<SocialActionResult, FormData>(saveXAppSettings, {});
  return <details className="social-disclosure" open={source === "none"}>
    <summary><span><b>X 开发者应用</b><small>{source === "none" ? "连接账号前需要完成" : "低频设置，两个账号共用"}</small></span><span className={`chip ${source === "none" ? "bear" : "acc"}`}>{source === "console" ? "已在后台配置" : source === "environment" ? "服务器配置" : "需要配置"}</span></summary>
    <div className="social-disclosure-body">
    <form action={action} className="llm-form">
      <div className="form-grid"><label><span>Client ID</span><input name="clientId" defaultValue={clientId} required autoComplete="off" spellCheck={false}/></label>
      <label><span>Client Secret</span><input name="clientSecret" type="password" autoComplete="new-password" spellCheck={false} placeholder={secretHint ? `已保存 ${secretHint}；留空表示不修改` : "从 X Developer Portal 复制"}/></label></div>
      {secretHint && <label className="llm-check"><input type="checkbox" name="clearSecret"/><span>清除已保存的 Client Secret</span></label>}
      <div className="social-callback"><span>OAuth 2.0 回调地址</span><code>{callbackUrl}</code><small>复制到 X Developer Portal。密钥保存后不会再次显示原文。</small></div>
      <div className="llm-form-row"><button className="minibtn p" type="submit" disabled={pending}>{pending ? "保存中…" : "保存 X 应用配置"}</button>{state.error && <span className="llm-msg bad" role="alert">{state.error}</span>}{state.ok && <span className="llm-msg good" role="status">{state.ok}</span>}</div>
    </form>
    </div>
  </details>;
}
