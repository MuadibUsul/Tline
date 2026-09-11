"use client";

import { useActionState } from "react";
import { saveFeishuSettings, testFeishuSettings, type SocialActionResult } from "./actions";

type Props = {
  appId: string;
  appSecretHint: string | null;
  encryptKeyHint: string | null;
  verificationTokenHint: string | null;
  receiveId: string;
  receiveIdType: string;
  approverOpenIds: string;
  callbackUrl: string;
  source: "console" | "environment" | "none";
  configured: boolean;
};

export default function FeishuSettings(props: Props) {
  const [saveState, saveAction, saving] = useActionState<SocialActionResult, FormData>(saveFeishuSettings, {});
  const [testState, testAction, testing] = useActionState<SocialActionResult, FormData>(testFeishuSettings, {});
  const placeholder = (hint: string | null, empty: string) => hint ? `已保存 ${hint}；留空表示不修改` : empty;

  return <details className="social-disclosure social-feishu" open={!props.configured}>
    <summary><span><b>飞书审核机器人</b><small>把待审核内容发送到你的飞书手机</small></span><span className={`chip ${props.configured ? "acc" : "bear"}`}>{!props.configured ? "需要配置" : props.source === "console" ? "已在后台配置" : "服务器配置"}</span></summary>
    <div className="social-disclosure-body">
      <p className="sub">在飞书开放平台创建企业自建应用并启用机器人，然后把“凭证与基础信息”和“事件与回调”中的内容填到这里。</p>
      <form action={saveAction} className="llm-form">
        <div className="section-t"><span>应用身份</span></div>
        <div className="form-grid">
          <label><span>App ID</span><input name="appId" defaultValue={props.appId} required autoComplete="off" spellCheck={false}/></label>
          <label><span>App Secret</span><input name="appSecret" type="password" autoComplete="new-password" spellCheck={false} placeholder={placeholder(props.appSecretHint, "从飞书开放平台复制")}/></label>
        </div>

        <div className="section-t"><span>消息与审核人</span></div>
        <div className="form-grid">
          <label><span>消息接收类型</span><select name="receiveIdType" defaultValue={props.receiveIdType}><option value="open_id">个人 Open ID</option><option value="chat_id">群聊 Chat ID</option><option value="user_id">企业 User ID</option><option value="union_id">Union ID</option><option value="email">企业邮箱</option></select></label>
          <label><span>消息接收 ID</span><input name="receiveId" defaultValue={props.receiveId} required autoComplete="off" spellCheck={false} placeholder="个人 Open ID 或群聊 Chat ID"/></label>
        </div>
        <label><span>允许审核的用户 Open ID</span><input name="approverOpenIds" defaultValue={props.approverOpenIds} required autoComplete="off" spellCheck={false} placeholder="ou_xxx；多人用英文逗号分隔"/></label>

        <div className="section-t"><span>回调安全</span></div>
        <div className="form-grid">
          <label><span>Encrypt Key</span><input name="encryptKey" type="password" autoComplete="new-password" spellCheck={false} placeholder={placeholder(props.encryptKeyHint, "飞书事件订阅中的 Encrypt Key")}/></label>
          <label><span>Verification Token（可选）</span><input name="verificationToken" type="password" autoComplete="new-password" spellCheck={false} placeholder={placeholder(props.verificationTokenHint, "飞书事件订阅中的 Verification Token")}/></label>
        </div>
        <div className="social-callback"><span>飞书事件回调地址</span><code>{props.callbackUrl}</code><small>复制到飞书开放平台的事件与回调配置。所有密钥均加密保存，不会再次显示原文。</small></div>
        <div className="llm-form-row"><button className="minibtn p" type="submit" disabled={saving}>{saving ? "保存中…" : "保存飞书配置"}</button>{saveState.error && <span className="llm-msg bad" role="alert">{saveState.error}</span>}{saveState.ok && <span className="llm-msg good" role="status">{saveState.ok}</span>}</div>
      </form>
      {props.configured && <form action={testAction} className="social-feishu-test"><button className="minibtn" type="submit" disabled={testing}>{testing ? "发送中…" : "发送测试消息"}</button>{testState.error && <span className="llm-msg bad" role="alert">{testState.error}</span>}{testState.ok && <span className="llm-msg good" role="status">{testState.ok}</span>}</form>}
    </div>
  </details>;
}
