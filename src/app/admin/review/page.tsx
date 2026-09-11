import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAdminLocale, tr, localePath } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { queueContentRetry, resolveContentReview } from "../actions";
import { age } from "../_components/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "内容审核" };

const PAGE_SIZE = 40;

export default async function ReviewPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const locale = await getAdminLocale();
  const article = { include: { institution: true } } as const;

  const [analysisReview, translationReview, retries, analysisTotal, translationTotal] = await Promise.all([
    prisma.analysis.findMany({ where: { reviewStatus: "needs_review" }, orderBy: { createdAt: "desc" }, take: PAGE_SIZE, include: { article } }),
    prisma.articleTranslation.findMany({ where: { status: "needs_review" }, orderBy: { updatedAt: "desc" }, take: PAGE_SIZE, include: { article } }),
    prisma.contentRetry.findMany({ orderBy: { requestedAt: "desc" }, take: 20 }),
    prisma.analysis.count({ where: { reviewStatus: "needs_review" } }),
    prisma.articleTranslation.count({ where: { status: "needs_review" } }),
  ]);

  const queue = [
    ...analysisReview.map((item) => ({ key: `a-${item.id}`, at: item.createdAt, article: item.article, kind: "analysis" as const })),
    ...translationReview.map((item) => ({ key: `t-${item.id}`, at: item.updatedAt, article: item.article, kind: "translation" as const })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Editorial review", "内容审核")}</h1>
        <p className="sub">{tr(locale, "Analysis and translations flagged for an editor's attention.", "分析与翻译中，需要编辑人工确认的内容。")}</p>
      </div>
      <div className="tag-row"><span className={`chip ${analysisTotal + translationTotal ? "bear" : "bull"}`}>{analysisTotal + translationTotal} {tr(locale, "waiting", "待处理")}</span></div>
    </header>

    <section className="admin-stats" aria-label={tr(locale, "Review summary", "审核概览")}>
      <div className="admin-stat"><span>{tr(locale, "Analysis", "分析")}</span><b>{analysisTotal}</b><small>{tr(locale, "needs review", "待审核")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Translation", "翻译")}</span><b>{translationTotal}</b><small>{tr(locale, "needs review", "待审核")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Re-runs queued", "已排队重跑")}</span><b>{retries.filter((retry) => retry.status === "queued").length}</b><small>{retries.length} {tr(locale, "recent", "最近")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Shown here", "本页显示")}</span><b>{queue.length}</b><small>{tr(locale, `newest ${PAGE_SIZE} of each kind`, `每类最新 ${PAGE_SIZE} 条`)}</small></div>
    </section>

    <section className="blk">
      <div className="section-t"><span>{tr(locale, "Needs review", "待审核")}</span><span className="chip gray">{queue.length}</span></div>
      <div className="admin-review-list">
        {queue.length === 0 && <div className="empty-state">{tr(locale, "Nothing is waiting for review.", "当前没有待审核内容。")}</div>}
        {queue.map((item) => <div className="admin-review-row" key={item.key}>
          <Link href={localePath(locale, `/research/${item.article.id}`)}>
            <span><b>{item.article.title}</b><small>{item.article.institution.name} · {item.kind} · {age(item.at, locale)}</small></span>
            <span className="chip bear">需要审核</span>
          </Link>
          {/* The rerun lives here rather than only on the report: this list is where an
              operator decides, and a decision that costs a page visit is not taken. */}
          <form action={queueContentRetry}>
            <input type="hidden" name="articleId" value={item.article.id} />
            <input type="hidden" name="kind" value={item.kind} />
            <button className="minibtn" type="submit">{tr(locale, "Re-run", "重跑")}</button>
          </form>
          <form action={resolveContentReview}>
            <input type="hidden" name="articleId" value={item.article.id} />
            <input type="hidden" name="kind" value={item.kind} />
            <button className="minibtn p" type="submit">{tr(locale, "Mark reviewed", "标记已审核")}</button>
          </form>
        </div>)}
      </div>
    </section>
  </>;
}
