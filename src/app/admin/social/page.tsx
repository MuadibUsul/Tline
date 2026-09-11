import Link from "next/link";
import { prisma } from "@/lib/db";
import { getAdminLocale, localePath, tr } from "@/lib/i18n";
import { adminLabel } from "../_components/format";
import { createSocialAccount, saveSocialAccount } from "./actions";

export const dynamic = "force-dynamic";

export default async function SocialPage() {
  const locale = await getAdminLocale();
  const [accounts, drafts] = await Promise.all([
    prisma.socialAccount.findMany({ orderBy: { createdAt: "asc" }, include: { routes: true } }),
    prisma.socialDraft.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { deliveries: { include: { account: true } } } }),
  ]);
  return <>
    <header className="page-head admin-head"><div><h1>{tr(locale, "Publishing", "内容发布")}</h1><p className="sub">{tr(locale, "Feishu approval and fixed multi-account routing.", "飞书审核、固定多账号路由与投递记录。")}</p></div></header>
    <section className="blk"><div className="section-t"><span>{tr(locale, "X accounts", "X 账号")}</span><span className="chip gray">{accounts.length}/2</span></div>
      {accounts.map((account) => <form action={saveSocialAccount} className="fcard" key={account.id}>
        <input type="hidden" name="id" value={account.id}/><div className="form-grid">
          <label>{tr(locale, "Name", "名称")}<input name="label" defaultValue={account.label} required/></label>
          <label>{tr(locale, "Language", "语言")}<select name="language" defaultValue={account.language}><option value="en">英文</option><option value="zh-CN">中文</option></select></label>
        </div>
        <div className="tag-row"><label><input type="checkbox" name="enabled" defaultChecked={account.enabled}/> 启用账号</label><label><input type="checkbox" name="macro" defaultChecked={account.routes.some((r) => r.sourceKind === "macro" && r.enabled)}/> 发布宏观数据</label><label><input type="checkbox" name="research" defaultChecked={account.routes.some((r) => r.sourceKind === "research" && r.enabled)}/> 发布研报</label></div>
        <p className="admin-hint">名称仅供后台识别；语言决定使用中文稿还是英文稿。勾选内容类型后，该账号会接收相应候选；完成“连接 X”后才能正式发布。</p>
        <p className="sub">{account.externalUsername ? `@${account.externalUsername}` : tr(locale, "Not connected", "尚未连接")}{account.lastError ? ` · ${account.lastError}` : ""}</p>
        <div className="tag-row"><button className="minibtn p" type="submit">{tr(locale, "Save", "保存")}</button><a className="minibtn" href={`/api/social/x/connect?accountId=${account.id}`}>{account.externalUsername ? tr(locale, "Reconnect X", "重新连接 X") : tr(locale, "Connect X", "连接 X")}</a></div>
      </form>)}
      {accounts.length < 2 && <form action={createSocialAccount} className="fcard"><div className="form-grid"><label>{tr(locale, "Account label", "账号名称")}<input name="label" required placeholder="例如：英文研报账号"/></label><label>{tr(locale, "Language", "语言")}<select name="language"><option value="en">英文</option><option value="zh-CN">中文</option></select></label></div><button className="minibtn p" type="submit">{tr(locale, "Add account", "添加账号")}</button></form>}
    </section>
    <section className="blk"><div className="section-t"><span>{tr(locale, "Review & delivery", "审核与投递")}</span><span className="chip gray">{drafts.length}</span></div><div className="admin-review-list">
      {drafts.map((draft) => <div className="admin-review-row" key={draft.id}><Link href={localePath(locale, `/admin/social/${draft.id}`)}><span><b>{draft.title}</b><small>{adminLabel(draft.sourceKind)} · 第 {draft.version} 版 · {draft.deliveries.map((d) => `${d.account.label}：${adminLabel(d.status)}`).join(" · ") || "尚未批准"}</small></span><span className={`chip ${draft.status === "SUCCEEDED" ? "bull" : draft.status === "FAILED" ? "bear" : "gray"}`}>{adminLabel(draft.status)}</span></Link></div>)}
      {!drafts.length && <div className="empty-state">{tr(locale, "No publishing candidates yet.", "暂无发布候选。")}</div>}
    </div></section>
  </>;
}
