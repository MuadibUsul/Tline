import Link from "next/link";
import { prisma } from "@/lib/db";
import { relTime } from "@/app/_components/ui";
import { formatDate, getLocale, tr, type Locale } from "@/lib/i18n";
import { rankAtomicViews, type MarketEvent } from "@/lib/viewRanking";
import marketEvents from "../../../data/market-events.json";

export const dynamic = "force-dynamic";

const TYPE_ZH: Record<string, string> = {
  forecast: "预测", target: "目标", direction: "方向", conditional: "条件观点",
  risk: "风险", rationale: "逻辑", market_impact: "市场影响",
};

function directionLabel(direction: string, locale: Locale) {
  if (locale === "en") return direction;
  return ({ bullish: "看多", bearish: "看空", neutral: "中性", conditional: "条件性" } as Record<string, string>)[direction] ?? direction;
}

export default async function ViewsPage({ searchParams }: { searchParams: { page?: string } }) {
  const locale = getLocale();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const take = 50;
  // ponytail: rank in memory while the corpus is small; persist scores when this reaches tens of thousands of views.
  const allViews = await prisma.atomicView.findMany({ include: { article: { include: { institution: true } } } });
  const ranked = rankAtomicViews(allViews, new Date(), marketEvents as MarketEvent[]);
  const total = ranked.length;
  const views = ranked.slice((page - 1) * take, page * take);
  const pages = Math.max(1, Math.ceil(total / take));

  return (
    <main className="wrap view-stream-wrap">
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Institutional Wire", "机构短讯")}</div>
        <h1>{tr(locale, "Views", "观点")}</h1>
        <p className="sub">{tr(locale, `${total} evidence-backed views, ranked by market heat, institution authority and freshness.`, `共 ${total} 条可追溯观点，依次按市场热度、机构权重和新鲜度排序。`)}</p>
      </div>

      <section className="view-flash-list" aria-label={tr(locale, "Latest institutional views", "最新机构观点")}>
        {views.map((view, viewIndex) => {
          const tone = view.direction === "bullish" ? "bull" : view.direction === "bearish" ? "bear" : "neu";
          const copy = locale === "zh-CN" ? view.viewZh : view.viewEn;
          return (
            <article className="view-flash" key={view.id}>
              <div className="view-rank"><b>#{(page - 1) * take + viewIndex + 1}</b><time dateTime={view.article.publishedAt.toISOString()} title={formatDate(view.article.publishedAt, locale)}>{relTime(view.article.publishedAt, locale)}</time></div>
              <div className="view-flash-main">
                <div className="view-flash-meta">
                  <Link href={`/institution/${view.article.institution.slug}`}>{view.article.institution.name}</Link>
                  <span className={`chip ${tone}`}>{directionLabel(view.direction, locale)}</span>
                  <span className="chip gray">{locale === "zh-CN" ? TYPE_ZH[view.type] ?? view.type : view.type.replace("_", " ")}</span>
                  {view.assetTicker ? <Link href={`/asset/${view.assetTicker}`} className="chip acc">{view.asset} · {view.assetTicker}</Link> : <span className="chip acc">{view.asset}</span>}
                  {view.matchedEvent && <a href={view.matchedEvent.sourceUrl} target="_blank" rel="noopener noreferrer" className="chip bear">{locale === "zh-CN" ? view.matchedEvent.titleZh : view.matchedEvent.titleEn}</a>}
                  <span className="view-horizon">{view.timeHorizon}</span>
                </div>
                <h2><Link href={`/research/${view.articleId}`}>{copy}</Link></h2>
                <div className="view-flash-foot">
                  {view.value && <b>{view.value}</b>}
                  <span>{view.topic}</span><span>{"★".repeat(view.importance)}</span>
                  <span title={tr(locale, "7-day cross-institution and event heat", "7天跨机构与事件热度")}>{tr(locale, "Heat", "热度")} {view.heatScore}{view.crossInstitutionCount > 1 ? ` · ${view.crossInstitutionCount}${tr(locale, " inst.", "家机构")}` : ""}</span>
                  <span title={tr(locale, "Institution authority and rating", "机构权威度与评级")}>{tr(locale, "Authority", "机构")} {view.authorityScore}</span>
                  <span title={tr(locale, "Exponential recency score", "指数衰减新鲜度")}>{tr(locale, "Fresh", "新鲜")} {view.freshnessScore}</span>
                  <details><summary>{tr(locale, "Evidence", "原文依据")}</summary><blockquote>{view.sourceQuote}</blockquote></details>
                </div>
              </div>
            </article>
          );
        })}
        {views.length === 0 && <div className="empty-state">{tr(locale, "No atomic views have been extracted yet.", "暂未提取出原子观点。")}</div>}
      </section>

      {pages > 1 && <nav className="pagination" aria-label={tr(locale, "View pages", "观点分页")}>
        {page > 1 && <Link href={`/institutions?page=${page - 1}`}>← {tr(locale, "Previous", "上一页")}</Link>}
        <span>{tr(locale, `Page ${page} / ${pages}`, `第 ${page} / ${pages} 页`)}</span>
        {page < pages && <Link href={`/institutions?page=${page + 1}`}>{tr(locale, "Next", "下一页")} →</Link>}
      </nav>}
    </main>
  );
}
