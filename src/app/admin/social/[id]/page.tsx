import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminLocale, localePath } from "@/lib/i18n";
import { adminLabel } from "../../_components/format";
import { decideSocialDraft, regenerateSocialDraft, retryFeishuNotification, retrySocialDelivery, saveSocialDraft } from "../actions";
import { researchPath } from "@/lib/researchPath";

export const dynamic = "force-dynamic";

type Target = { label: string; language: string; username?: string | null };

function feishuMessage(error: string) {
  if (error.includes("FEISHU_REVIEW_RECEIVE_ID")) return "尚未设置飞书审核人。你仍可在本页完成审核；配置审核人后可重新发送通知。";
  return `飞书通知发送失败：${error}`;
}

export default async function SocialDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await prisma.socialDraft.findUnique({ where: { id }, include: { deliveries: { include: { account: true } } } });
  if (!draft) notFound();
  const locale = await getAdminLocale();
  const article = draft.sourceKind === "research" ? await prisma.article.findUnique({ where: { id: draft.sourceId }, select: { slug: true } }) : null;
  const sourceHref = draft.sourceKind === "macro" ? `/macro/release/${draft.sourceId}` : article ? researchPath(article) : `/research/${draft.sourceId}`;
  let targets: Target[] = [];
  try { const parsed = JSON.parse(draft.routeSnapshot); if (Array.isArray(parsed)) targets = parsed; } catch {}
  const languages = new Set(targets.map((target) => target.language));
  const showZh = languages.size === 0 || languages.has("zh-CN");
  const showEn = languages.size === 0 || languages.has("en");
  const pending = draft.status === "PENDING_REVIEW";

  return <div className="social-review">
    <header className="page-head admin-head">
      <div>
        <Link className="minibtn" href={localePath(locale, "/admin/social")}>← 返回内容发布</Link>
        <h1>{draft.title}</h1>
        <p className="sub">{adminLabel(draft.sourceKind)} · 第 {draft.version} 版 · {adminLabel(draft.status)}</p>
      </div>
      <Link className="minibtn" href={localePath(locale, sourceHref)} target="_blank">查看原始依据 ↗</Link>
    </header>

    <section className="social-review-route">
      <div>
        <span className="social-review-kicker">批准后发布到</span>
        <div className="social-review-targets">
          {targets.map((target) => <span className="chip acc" key={`${target.label}-${target.language}`}>
            {target.label}{target.username ? ` @${target.username}` : ""} · {adminLabel(target.language)}
          </span>)}
          {targets.length === 0 && <span className="chip bear">没有可用的发布账号</span>}
        </div>
      </div>
      <p>系统按账号语言选择下方稿件；主帖发布成功后，会自动在评论区补充同语言的网站链接。</p>
    </section>

    <section className="social-review-editor">
      <div className="section-t"><span>发布内容</span><small>只显示上述账号实际使用的语言</small></div>
      <form action={saveSocialDraft}>
        <input type="hidden" name="id" value={draft.id}/>
        {!showEn && <input type="hidden" name="textEn" value={draft.textEn}/>}
        {!showZh && <input type="hidden" name="textZh" value={draft.textZh}/>}
        {showZh && <label><span>中文账号将发布</span><textarea name="textZh" rows={8} defaultValue={draft.textZh} disabled={!pending}/></label>}
        {showEn && <label><span>英文账号将发布</span><textarea name="textEn" rows={8} defaultValue={draft.textEn} disabled={!pending}/></label>}
        {pending && <div className="social-review-save"><button className="minibtn" type="submit">保存修改并生成第 {draft.version + 1} 版</button><small>修改后，旧版本在飞书中的批准按钮会自动失效。</small></div>}
      </form>
    </section>

    {pending && <section className="social-review-decision">
      <div><b>确认内容无误后批准</b><p>批准后系统会向上述全部账号分别投递；每个账号独立重试，不会重复发布成功的主帖。</p></div>
      <div className="social-review-actions">
        <form action={decideSocialDraft}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="version" value={draft.version}/><input type="hidden" name="decision" value="approve"/><button className="minibtn p">批准并发布</button></form>
        <form action={regenerateSocialDraft}><input type="hidden" name="id" value={draft.id}/><button className="minibtn">重新生成文案</button></form>
        <form action={decideSocialDraft}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="version" value={draft.version}/><input type="hidden" name="decision" value="reject"/><button className="minibtn">拒绝</button></form>
      </div>
      {draft.notifyError && <div className="admin-notice bad"><b>飞书未送达</b><br/>{feishuMessage(draft.notifyError)}{!draft.feishuMessageId && draft.notifyAttempts >= 3 && <form action={retryFeishuNotification}><input type="hidden" name="id" value={draft.id}/><button className="minibtn">重新发送飞书通知</button></form>}</div>}
    </section>}

    {(draft.deliveries.length > 0 || !pending) && <section className="social-review-results">
      <div className="section-t"><span>发布结果</span></div>
      {draft.deliveries.length === 0 && <p className="sub">尚未创建投递任务。</p>}
      {draft.deliveries.map((delivery) => <div className="fcard" key={delivery.id}><b>{delivery.account.label} · {adminLabel(delivery.language)}</b><p>{adminLabel(delivery.status)}{delivery.mainPostId ? ` · 主帖 ${delivery.mainPostId}` : ""}{delivery.replyPostId ? ` · 链接评论 ${delivery.replyPostId}` : ""}</p>{delivery.lastError && <p className="sub">{delivery.lastError}</p>}{["FAILED", "RETRY"].includes(delivery.status) && <form action={retrySocialDelivery}><input type="hidden" name="id" value={delivery.id}/><button className="minibtn">重试未完成步骤</button></form>}</div>)}
    </section>}
  </div>;
}
