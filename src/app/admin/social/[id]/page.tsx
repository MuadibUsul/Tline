import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getLocale, localePath, tr } from "@/lib/i18n";
import { decideSocialDraft, regenerateSocialDraft, retryFeishuNotification, retrySocialDelivery, saveSocialDraft } from "../actions";

export const dynamic = "force-dynamic";

export default async function SocialDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await prisma.socialDraft.findUnique({ where: { id }, include: { deliveries: { include: { account: true } } } });
  if (!draft) notFound();
  const locale = await getLocale();
  const sourceHref = draft.sourceKind === "macro" ? `/macro/release/${draft.sourceId}` : `/research/${draft.sourceId}`;
  let targets: Array<{ label: string; language: string; username?: string | null }> = [];
  try { const parsed = JSON.parse(draft.routeSnapshot); if (Array.isArray(parsed)) targets = parsed; } catch {}
  return <>
    <header className="page-head admin-head"><div><Link className="minibtn" href={localePath(locale, "/admin/social")}>← {tr(locale, "Publishing", "内容发布")}</Link><h1>{draft.title}</h1><p className="sub">{draft.sourceKind} · v{draft.version} · {draft.status}</p><Link className="minibtn" href={localePath(locale, sourceHref)} target="_blank">{tr(locale, "Open evidence", "查看依据")} ↗</Link></div></header>
    <section className="blk"><div className="section-t"><span>{tr(locale, "Fixed targets", "固定发布目标")}</span></div><p>{targets.map((target) => `${target.label}${target.username ? ` (@${target.username})` : ""} · ${target.language}`).join(" · ") || tr(locale, "No route snapshot", "没有路由快照")}</p></section>
    <section className="blk"><form action={saveSocialDraft}><input type="hidden" name="id" value={draft.id}/><label>English<textarea name="textEn" rows={8} defaultValue={draft.textEn} disabled={draft.status !== "PENDING_REVIEW"}/></label><label>中文<textarea name="textZh" rows={8} defaultValue={draft.textZh} disabled={draft.status !== "PENDING_REVIEW"}/></label>{draft.status === "PENDING_REVIEW" && <button className="minibtn p" type="submit">{tr(locale, "Save new version", "保存为新版本")}</button>}</form></section>
    {draft.status === "PENDING_REVIEW" && <section className="blk"><div className="tag-row"><form action={decideSocialDraft}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="version" value={draft.version}/><input type="hidden" name="decision" value="approve"/><button className="minibtn p">{tr(locale, "Approve all routes", "批准全部路由")}</button></form><form action={decideSocialDraft}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="version" value={draft.version}/><input type="hidden" name="decision" value="reject"/><button className="minibtn">{tr(locale, "Reject", "拒绝")}</button></form><form action={regenerateSocialDraft}><input type="hidden" name="id" value={draft.id}/><button className="minibtn">{tr(locale, "Regenerate", "重新生成")}</button></form>{!draft.feishuMessageId && draft.notifyAttempts >= 3 && <form action={retryFeishuNotification}><input type="hidden" name="id" value={draft.id}/><button className="minibtn">{tr(locale, "Retry Feishu", "重试飞书")}</button></form>}</div>{draft.notifyError && <p className="sub">Feishu: {draft.notifyError}</p>}</section>}
    <section className="blk"><div className="section-t"><span>{tr(locale, "Deliveries", "投递结果")}</span></div>{draft.deliveries.map((delivery) => <div className="fcard" key={delivery.id}><b>{delivery.account.label} · {delivery.language}</b><p>{delivery.status}{delivery.mainPostId ? ` · main ${delivery.mainPostId}` : ""}{delivery.replyPostId ? ` · reply ${delivery.replyPostId}` : ""}</p>{delivery.lastError && <p className="sub">{delivery.lastError}</p>}{["FAILED", "RETRY"].includes(delivery.status) && <form action={retrySocialDelivery}><input type="hidden" name="id" value={delivery.id}/><button className="minibtn">{tr(locale, "Retry incomplete step", "重试未完成步骤")}</button></form>}</div>)}</section>
  </>;
}
