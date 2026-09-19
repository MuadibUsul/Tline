import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAdminLocale, tr, localePath } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { approveClassificationReview, correctClassificationReview, queueContentRetry, resolveContentReview } from "../actions";
import { age } from "../_components/format";
import { researchPath } from "@/lib/researchPath";
import { taxonomy } from "@/lib/classification/taxonomy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "内容审核" };

const PAGE_SIZE = 40;

export default async function ReviewPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const locale = await getAdminLocale();
  const article = { include: { institution: true } } as const;

  const [analysisReview, translationReview, classificationReview, retries, analysisTotal, translationTotal, classificationTotal] = await Promise.all([
    prisma.analysis.findMany({ where: { reviewStatus: "needs_review" }, orderBy: { createdAt: "desc" }, take: PAGE_SIZE, include: { article } }),
    prisma.articleTranslation.findMany({ where: { status: "needs_review" }, orderBy: { updatedAt: "desc" }, take: PAGE_SIZE, include: { article } }),
    prisma.contentClassification.findMany({
      where: { status: "REVIEW", articleId: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: PAGE_SIZE,
      include: { article: { include: { institution: true } }, jurisdictions: true, institutions: true, topics: true, events: true, assetClasses: true, assets: { include: { asset: true } } },
    }),
    prisma.contentRetry.findMany({ orderBy: { requestedAt: "desc" }, take: 20 }),
    prisma.analysis.count({ where: { reviewStatus: "needs_review" } }),
    prisma.articleTranslation.count({ where: { status: "needs_review" } }),
    prisma.contentClassification.count({ where: { status: "REVIEW" } }),
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
      <div className="tag-row"><span className={`chip ${analysisTotal + translationTotal + classificationTotal ? "bear" : "bull"}`}>{analysisTotal + translationTotal + classificationTotal} {tr(locale, "waiting", "待处理")}</span></div>
    </header>

    <section className="admin-stats" aria-label={tr(locale, "Review summary", "审核概览")}>
      <div className="admin-stat"><span>{tr(locale, "Analysis", "分析")}</span><b>{analysisTotal}</b><small>{tr(locale, "needs review", "待审核")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Translation", "翻译")}</span><b>{translationTotal}</b><small>{tr(locale, "needs review", "待审核")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Classification", "分类")}</span><b>{classificationTotal}</b><small>{tr(locale, "needs review", "待审核")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Re-runs queued", "已排队重跑")}</span><b>{retries.filter((retry) => retry.status === "queued").length}</b><small>{retries.length} {tr(locale, "recent", "最近")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Shown here", "本页显示")}</span><b>{queue.length}</b><small>{tr(locale, `newest ${PAGE_SIZE} of each kind`, `每类最新 ${PAGE_SIZE} 条`)}</small></div>
    </section>

    <section className="blk">
      <div className="section-t"><span>{tr(locale, "Needs review", "待审核")}</span><span className="chip gray">{queue.length}</span></div>
      <div className="admin-review-list">
        {queue.length === 0 && <div className="empty-state">{tr(locale, "Nothing is waiting for review.", "当前没有待审核内容。")}</div>}
        {queue.map((item) => <div className="admin-review-row" key={item.key}>
          <Link href={localePath(locale, researchPath(item.article))}>
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

    <section className="blk">
      <div className="section-t"><span>{tr(locale, "Classification review", "分类审核")}</span><span className="chip gray">{classificationReview.length}</span></div>
      <p className="sub">{tr(locale, "Approve only after checking the structured facets against the source. Approval records an audit event; it does not rewrite the classifier provenance.", "请对照原文确认结构化维度后再通过。通过操作会写入审计记录，但不会篡改分类器来源。")}</p>
      <div className="admin-review-list">
        {classificationReview.length === 0 && <div className="empty-state">{tr(locale, "No classification is waiting for review.", "当前没有待审核分类。")}</div>}
        {classificationReview.map((item) => {
          if (!item.article) return null;
          const primaryJurisdiction = item.jurisdictions.find((facet) => facet.role === "PRIMARY")?.jurisdictionKey ?? "";
          const relatedJurisdictions = item.jurisdictions.filter((facet) => facet.role === "RELATED").map((facet) => facet.jurisdictionKey);
          const primaryInstitution = item.institutions.find((facet) => facet.role === "PRIMARY")?.institutionKey ?? "";
          const relatedInstitutions = item.institutions.filter((facet) => facet.role === "RELATED").map((facet) => facet.institutionKey);
          return <div className="admin-review-row" key={item.id}>
          <Link href={localePath(locale, researchPath(item.article))}>
            <span><b>{item.article.title}</b><small>{item.article.institution.name} · {item.source} · {(item.confidence * 100).toFixed(0)}%</small></span>
            <span className="tag-row">
              {item.jurisdictions.map((facet) => <span className="chip acc" key={facet.id}>{taxonomy.jurisdictions.find((definition) => definition.key === facet.jurisdictionKey)?.nameZh ?? facet.jurisdictionKey}</span>)}
              {item.topics.map((facet) => <span className="chip gray" key={facet.id}>{taxonomy.topics.find((definition) => definition.key === facet.topicKey)?.nameZh ?? facet.topicKey}</span>)}
              {item.institutions.map((facet) => <span className="chip gray" key={facet.id}>{taxonomy.institutions.find((definition) => definition.key === facet.institutionKey)?.nameZh ?? facet.institutionKey}</span>)}
            </span>
          </Link>
          <form action={approveClassificationReview}>
            <input type="hidden" name="classificationId" value={item.id} />
            <button className="minibtn p" type="submit">{tr(locale, "Approve classification", "通过分类")}</button>
          </form>
          <details>
            <summary className="minibtn">{tr(locale, "Correct facets", "修正分类")}</summary>
            <form action={correctClassificationReview} className="admin-form">
              <input type="hidden" name="classificationId" value={item.id} />
              <div className="form-grid">
                <label><span>{tr(locale, "Jurisdiction state", "地域状态")}</span><select name="jurisdictionState" defaultValue={item.jurisdictionState}><option>KNOWN</option><option>MULTIPLE</option><option>GLOBAL</option><option>UNKNOWN</option><option>NONE</option><option>NOT_APPLICABLE</option></select></label>
                <label><span>{tr(locale, "Primary jurisdiction", "主要经济体")}</span><select name="primaryJurisdiction" defaultValue={primaryJurisdiction}><option value="">—</option>{taxonomy.jurisdictions.map((value) => <option value={value.key} key={value.key}>{locale === "zh-CN" ? value.nameZh : value.nameEn}</option>)}</select></label>
                <label><span>{tr(locale, "Related jurisdictions", "相关经济体")}</span><select name="relatedJurisdictions" multiple defaultValue={relatedJurisdictions}>{taxonomy.jurisdictions.map((value) => <option value={value.key} key={value.key}>{locale === "zh-CN" ? value.nameZh : value.nameEn}</option>)}</select></label>
                <label><span>{tr(locale, "Primary subject institution", "主要对象机构")}</span><select name="primaryInstitution" defaultValue={primaryInstitution}><option value="">—</option>{taxonomy.institutions.map((value) => <option value={value.key} key={value.key}>{locale === "zh-CN" ? value.nameZh : value.nameEn}</option>)}</select></label>
                <label><span>{tr(locale, "Related subject institutions", "相关对象机构")}</span><select name="relatedInstitutions" multiple defaultValue={relatedInstitutions}>{taxonomy.institutions.map((value) => <option value={value.key} key={value.key}>{locale === "zh-CN" ? value.nameZh : value.nameEn}</option>)}</select></label>
                <label><span>{tr(locale, "Topics", "主题")}</span><select name="topics" multiple defaultValue={item.topics.map((facet) => facet.topicKey)}>{taxonomy.topics.map((value) => <option value={value.key} key={value.key}>{locale === "zh-CN" ? value.nameZh : value.nameEn}</option>)}</select></label>
                <label><span>{tr(locale, "Events", "事件")}</span><select name="events" multiple defaultValue={item.events.map((facet) => facet.eventKey)}>{taxonomy.events.map((value) => <option value={value.key} key={value.key}>{locale === "zh-CN" ? value.nameZh : value.nameEn}</option>)}</select></label>
                <label><span>{tr(locale, "Asset classes", "资产类别")}</span><select name="assetClasses" multiple defaultValue={item.assetClasses.map((facet) => facet.assetClassKey)}>{taxonomy.assetClasses.map((value) => <option value={value.key} key={value.key}>{locale === "zh-CN" ? value.nameZh : value.nameEn}</option>)}</select></label>
                <label><span>{tr(locale, "Assets", "资产")}</span><input name="assets" defaultValue={item.assets.map((facet) => facet.asset.ticker).join(", ")} placeholder="SPX, USD, US10Y" /></label>
                <label><span>{tr(locale, "Content type", "内容类型")}</span><select name="contentType" defaultValue={item.contentType}>{taxonomy.contentTypes.map((value) => <option value={value.key} key={value.key}>{locale === "zh-CN" ? value.nameZh : value.nameEn}</option>)}</select></label>
              </div>
              <p className="sub">{tr(locale, "Ctrl/Cmd-click selects multiple values. Saving marks the result MANUAL and protects it from later JEV backfills.", "按住 Ctrl/Cmd 可多选。保存后来源会标记为 MANUAL，后续 JEV 回填不会覆盖。")}</p>
              <button className="minibtn p" type="submit">{tr(locale, "Save manual correction", "保存人工修正")}</button>
            </form>
          </details>
        </div>;
        })}
      </div>
    </section>
  </>;
}
