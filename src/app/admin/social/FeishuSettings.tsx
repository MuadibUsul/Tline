"use client";

import { useActionState } from "react";
import { saveFeishuSettings, testFeishuSettings, type SocialActionResult } from "./actions";
import type { FeishuConfigStage } from "@/lib/social/feishu";

type Props = {
  appId: string;
  appSecretHint: string | null;
  encryptKeyHint: string | null;
  verificationTokenHint: string | null;
  receiveId: string;
  receiveIdType: string;
  approverOpenIds: string;
  callbackUrl: string;
  status: FeishuConfigStage;
};

const STAGE_CHIP: Record<FeishuConfigStage, string> = { none: "bear", basic: "bull", receiver_pending: "bear", complete: "acc" };
const STAGE_LABEL: Record<FeishuConfigStage, string> = { none: "未配置", basic: "基础配置已保存", receiver_pending: "待配置消息接收人", complete: "配置完成" };

export default function FeishuSettings(props: Props) {
  const [saveState, saveAction, saving] = useActionState<SocialActionResult, FormData>(saveFeishuSettings, {});
  const [testState, testAction, testing] = useActionState<SocialActionResult, FormData>(testFeishuSettings, {});
  // `clear` fields never show their stored value, so leaving them empty saves empty;
  // the App Secret stays required and keeps its stored value when left untouched.
  const placeholder = (hint: string | null, empty: string, clear: boolean) => hint
    ? clear ? `已保存 ${hint}；留空保存将清空` : `已保存 ${hint}；留空表示不修改`
    : clear ? `${empty}；留空保存将清空` : empty;

  return <details className="social-disclosure social-feishu" open={props.status !== "complete"}>
    <summary><span><b>飞书审核机器人</b><small>把待审核内容发送到你的飞书手机</small></span><span className={`chip ${STAGE_CHIP[props.status]}`}>{STAGE_LABEL[props.status]}</span></summary>
    <div className="social-disclosure-body">
      <p className="sub">{props.status === "none" ? "只需 App ID 和 App Secret 即可先保存基础配置，其余字段可以稍后补充。" : props.status === "complete" ? "配置已完成，可以发送测试消息并在飞书里审核发布。" : "继续填写消息接收 ID 和审核人 Open ID，完成后才能发送审核卡片。"}</p>
      <form action={saveAction} className="llm-form">
        <div className="section-t"><span>应用身份</span></div>
        <div className="form-grid">
          <label><span>App ID</span><input name="appId" defaultValue={props.appId} required autoComplete="off" spellCheck={false}/></label>
          <label><span>App Secret</span><input name="appSecret" type="password" autoComplete="new-password" spellCheck={false} placeholder={placeholder(props.appSecretHint, "从飞书开放平台复制", false)}/></label>
        </div>

        <div className="section-t"><span>消息与审核人（可稍后填写）</span></div>
        <div className="form-grid">
          <label><span>消息接收类型</span><select name="receiveIdType" defaultValue={props.receiveIdType}><option value="open_id">个人 Open ID</option><option value="chat_id">群聊 Chat ID</option><option value="user_id">企业 User ID</option><option value="union_id">Union ID</option><option value="email">企业邮箱</option></select></label>
          <label><span>消息接收 ID</span><input name="receiveId" defaultValue={props.receiveId} autoComplete="off" spellCheck={false} placeholder="个人 Open ID 或群聊 Chat ID"/></label>
        </div>
        <label><span>允许审核的用户 Open ID</span><input name="approverOpenIds" defaultValue={props.approverOpenIds} autoComplete="off" spellCheck={false} placeholder="ou_xxx；多人用英文逗号分隔；留空则拒绝所有审核操作"/></label>

        <div className="section-t"><span>回调安全</span></div>
        <div className="form-grid">
          <label><span>Encrypt Key</span><input name="encryptKey" type="password" autoComplete="new-password" spellCheck={false} placeholder={placeholder(props.encryptKeyHint, "飞书事件订阅中的 Encrypt Key", true)}/></label>
          <label><span>Verification Token（可选）</span><input name="verificationToken" type="password" autoComplete="new-password" spellCheck={false} placeholder={placeholder(props.verificationTokenHint, "飞书事件订阅中的 Verification Token", true)}/></label>
        </div>
        <div className="social-callback"><span>飞书事件回调地址</span><code>{props.callbackUrl}</code><small>复制到飞书开放平台的事件与回调配置。所有密钥均加密保存，不会再次显示原文。</small></div>
        <div className="llm-form-row"><button className="minibtn p" type="submit" disabled={saving}>{saving ? "保存中…" : "保存飞书配置"}</button>{saveState.error && <span className="llm-msg bad" role="alert">{saveState.error}</span>}{saveState.ok && <span className="llm-msg good" role="status">{saveState.ok}</span>}</div>
      </form>
      {props.status !== "none" && <form action={testAction} className="social-feishu-test"><button className="minibtn" type="submit" disabled={testing}>{testing ? "发送中…" : "发送测试消息"}</button>{testState.error && <span className="llm-msg bad" role="alert">{testState.error}</span>}{testState.ok && <span className="llm-msg good" role="status">{testState.ok}</span>}</form>}
    </div>
  </details>;
}
