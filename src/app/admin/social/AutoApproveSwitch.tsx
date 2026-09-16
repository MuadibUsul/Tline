"use client";

import { useActionState } from "react";
import { setAutoApprove, type SocialActionResult } from "./actions";

/**
 * The five-star auto-approval switch.
 *
 * Stated as the state it is being set to rather than as a toggle: two posts of the same
 * form (a double click, a retried request) must leave the switch where the operator put
 * it. Off is the default, and the panel says what turning it on actually does — this
 * publishes to a public account without anyone reading the post first.
 */
export default function AutoApproveSwitch({ enabled, autoApprovedCount }: { enabled: boolean; autoApprovedCount: number }) {
  const [state, action, pending] = useActionState<SocialActionResult, FormData>(setAutoApprove, {});
  return <details className={`social-disclosure auto-approve ${enabled ? "on" : ""}`} open={enabled}>
    <summary>
      <span><b>五级数据自动发布</b><small>{enabled ? "已开启：数值与前值、预期齐备且解读已生成时直接发布" : "关闭中：所有候选都要人工批准"}</small></span>
      <span className={`chip ${enabled ? "bull" : "gray"}`}>{enabled ? "已开启" : "已关闭"}</span>
    </summary>
    <div className="social-disclosure-body">
      <p className="admin-hint">
        开启后，重要度为五级的数据发布在满足全部条件时跳过人工批准、直接发到账号，并照常在飞书群通知（卡片不再带批准按钮）。
        条件是：前值、市场预期、公布值齐备，双语解读已生成，且推文文案通过校验。任一条件不满足仍会留在待审核，
        四~五级之外的发布不受此开关影响。{autoApprovedCount > 0 && <> 最近 24 小时已自动发布 <b>{autoApprovedCount}</b> 条。</>}
      </p>
      <form action={action} className="llm-form">
        <input type="hidden" name="enabled" value={enabled ? "off" : "on"}/>
        <div className="llm-form-row">
          <button className={`minibtn ${enabled ? "" : "p"}`} type="submit" disabled={pending}>
            {pending ? "保存中…" : enabled ? "关闭自动发布" : "开启自动发布"}
          </button>
          {state.error && <span className="llm-msg bad" role="alert">{state.error}</span>}
          {state.ok && <span className="llm-msg good" role="status">{state.ok}</span>}
        </div>
      </form>
    </div>
  </details>;
}
