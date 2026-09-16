import Link from "next/link";
import { prisma } from "@/lib/db";
import { getAdminLocale, localePath, tr } from "@/lib/i18n";
import { adminLabel } from "../_components/format";
import { createSocialAccount, disconnectSocialAccount, saveSocialAccount } from "./actions";
import { secretHint } from "@/lib/secrets";
import { siteUrl } from "@/lib/site";
import XAppSettings from "./XAppSettings";
import FeishuSettings from "./FeishuSettings";
import AutoApproveSwitch from "./AutoApproveSwitch";
import { feishuConfigStatus, loadFeishuSettings } from "@/lib/social/feishu";
import { autoApproveReleaseEnabled } from "@/lib/social/autoApprove";

export const dynamic = "force-dynamic";

export default async function SocialPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const locale = await getAdminLocale();
  const [accounts, drafts, storedXApp, feishu, autoApproveOn, query] = await Promise.all([
    prisma.socialAccount.findMany({ orderBy: { createdAt: "asc" }, include: { routes: true } }),
    prisma.socialDraft.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { deliveries: { include: { account: true } } } }),
    prisma.socialPlatformCredential.findUnique({ where: { platform: "x" } }),
    loadFeishuSettings(),
    autoApproveReleaseEnabled(),
    searchParams,
  ]);
  const environmentClientId = process.env.X_CLIENT_ID || "";
  const clientId = storedXApp?.clientId || environmentClientId;
  const environmentSecret = process.env.X_CLIENT_SECRET || null;
  const xSource = storedXApp ? "console" as const : environmentClientId ? "environment" as const : "none" as const;
  const error = query.error === "x_config" ? "请先保存 X 应用配置。" : query.error === "account" ? "未找到要连接的 X 账号。" : query.error === "oauth_state" ? "X 授权已失效，请重新连接。" : query.error === "oauth_exchange" ? "X 授权失败，请检查应用配置和回调地址。" : null;
  const connected = accounts.filter((account) => account.externalUsername).length;
  const pending = drafts.filter((draft) => draft.status === "PENDING_REVIEW").length;
  const failed = drafts.filter((draft) => ["FAILED", "PARTIAL"].includes(draft.status)).length;
  const autoApproved = drafts.filter((draft) => draft.approvalMode === "auto" && draft.approvedAt && draft.approvedAt >= new Date(Date.now() - 86400_000)).length;
  return <>
    <header className="page-head admin-head social-head"><div><span className="eyebrow">发布工作台</span><h1>{tr(locale, "Publishing", "内容发布")}</h1><p className="sub">从平台授权到人工审核，按顺序完成每一步。</p></div><div className="social-summary" aria-label="发布状态"><span><b>{connected}/2</b> 已连接</span><span><b>{pending}</b> 待审核</span><span className={failed ? "bad" : ""}><b>{failed}</b> 异常</span></div></header>
    {error && <p className="admin-notice bad" role="alert">{error}</p>}
    {query.connected && <p className="admin-notice good" role="status">已连接 X 账号 @{query.connected}</p>}
    <div className="social-flow">
      <section className="social-flow-section"><div className="social-flow-guide"><span>1</span><div><b>渠道设置</b><small>应用与账号</small></div></div><div className="social-flow-content"><div className="social-panel-head"><div><h2>X 发布渠道</h2><p>先配置开发者应用，再连接最多两个发布账号。</p></div><span className="chip gray">{connected}/2 已连接</span></div><XAppSettings clientId={clientId} secretHint={storedXApp?.clientSecretHint || (environmentSecret ? secretHint(environmentSecret) : null)} callbackUrl={`${siteUrl()}/api/social/x/callback`} source={xSource}/><div className="social-account-list">
      {accounts.map((account) => <form action={saveSocialAccount} className="social-account" key={account.id}><details open={!account.externalUsername}>
        <summary className="social-account-head"><div><b>{account.label}</b><span className={`social-connection ${account.externalUsername ? "connected" : ""}`}>{account.externalUsername ? `@${account.externalUsername}` : tr(locale, "Not connected", "尚未连接")}</span></div><span className={`chip ${account.enabled ? "bull" : account.externalUsername ? "gray" : "bear"}`}>{account.enabled ? "发布中" : account.externalUsername ? "已停用" : "需要连接"}</span></summary>
        <div className="social-account-body">
        <input type="hidden" name="id" value={account.id}/><div className="form-grid social-account-fields">
          <label>{tr(locale, "Name", "后台名称")}<input name="label" defaultValue={account.label} required/></label>
          <label>{tr(locale, "Language", "发布语言")}<select name="language" defaultValue={account.language}><option value="en">英文</option><option value="zh-CN">中文</option></select></label>
        </div>
        <div className="social-route-options"><label><input type="checkbox" name="enabled" defaultChecked={account.enabled}/> 启用发布</label><label><input type="checkbox" name="macro" defaultChecked={account.routes.some((r) => r.sourceKind === "macro" && r.enabled)}/> 宏观数据</label><label><input type="checkbox" name="research" defaultChecked={account.routes.some((r) => r.sourceKind === "research" && r.enabled)}/> 研报</label></div>
        {account.lastError && <p className="admin-notice bad">{account.lastError}</p>}
        <div className="social-account-actions"><button className="minibtn" type="submit">{tr(locale, "Save", "保存设置")}</button><a className="minibtn p" href={`/api/social/x/connect?accountId=${account.id}`}>{account.externalUsername ? tr(locale, "Reconnect X", "重新授权") : tr(locale, "Connect X", "连接 X")}</a>{account.externalUsername && <button className="minibtn" type="submit" formAction={disconnectSocialAccount}>断开</button>}</div>
        </div></details></form>)}
      {accounts.length < 2 && <form action={createSocialAccount} className="social-account social-account-new"><div><b>添加发布账号</b><p>最多可连接两个 X 账号。</p></div><div className="form-grid"><label>{tr(locale, "Account label", "后台名称")}<input name="label" required placeholder="例如：英文研报账号"/></label><label>{tr(locale, "Language", "发布语言")}<select name="language"><option value="en">英文</option><option value="zh-CN">中文</option></select></label></div><button className="minibtn p" type="submit">{tr(locale, "Add account", "添加账号")}</button></form>}
      </div><FeishuSettings appId={feishu.appId} appSecretHint={feishu.appSecret ? secretHint(feishu.appSecret) : null} encryptKeyHint={feishu.encryptKey ? secretHint(feishu.encryptKey) : null} verificationTokenHint={feishu.verificationToken ? secretHint(feishu.verificationToken) : null} receiveId={feishu.receiveId} receiveIdType={feishu.receiveIdType} approverOpenIds={feishu.approverOpenIds} callbackUrl={`${siteUrl()}/api/social/feishu`} status={feishuConfigStatus(feishu)}/></div></section>
      <section className="social-flow-section"><div className="social-flow-guide"><span>2</span><div><b>审核发布</b><small>日常工作区</small></div></div><div className="social-flow-content"><div className="social-panel-head"><div><h2>{tr(locale, "Review & delivery", "审核与投递")}</h2><p>打开候选修改文案、批准发布，并查看每个账号的结果。</p></div><span className="chip gray">{drafts.length}</span></div><AutoApproveSwitch enabled={autoApproveOn} autoApprovedCount={autoApproved}/><div className="admin-review-list">
      {drafts.map((draft) => <div className="admin-review-row" key={draft.id}><Link href={localePath(locale, `/admin/social/${draft.id}`)}><span><b>{draft.title}</b><small>{adminLabel(draft.sourceKind)} · 第 {draft.version} 版{draft.approvalMode === "auto" ? " · 自动发布" : ""} · {draft.deliveries.map((d) => `${d.account.label}：${adminLabel(d.status)}`).join(" · ") || "尚未批准"}</small></span><span className={`chip ${draft.status === "SUCCEEDED" ? "bull" : draft.status === "FAILED" ? "bear" : "gray"}`}>{adminLabel(draft.status)}</span></Link></div>)}
      {!drafts.length && <div className="empty-state">{tr(locale, "No publishing candidates yet.", "暂无发布候选。")}</div>}
    </div></div></section>
    </div>
  </>;
}
