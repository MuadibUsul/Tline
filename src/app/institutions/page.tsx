import type { Metadata } from "next";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, collectionPageJsonLd, localizedUrl, ogImage, viewsSeoTitle } from "@/lib/seo";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { relTime } from "@/app/_components/ui";
import { articleTimestamp, assetName, domainTerm, formatDate, getLocale, institutionName, localizeChineseContent, localizedDataValue, tr, type Locale, localePath } from "@/lib/i18n";
import { clusterViewsNewestFirst, rankAtomicViews, VIEW_WINDOW_DAYS, type MarketEvent } from "@/lib/viewRanking";
import marketEvents from "../../../data/market-events.json";
import { publicationReadyWhere } from "@/lib/publication";
import { researchPath } from "@/lib/researchPath";
import { assetPath } from "@/lib/assetPath";
import { taxonomy } from "@/lib/classification/taxonomy";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { searchParams: Promise<{ page?: string }> }): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const locale = await getLocale();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const title = viewsSeoTitle(locale);
  const description = tr(
    locale,
    "The most consequential institutional views of the last seven days, ranked by cross-institution heat, publisher authority and freshness, each linked to the report it came from.",
    "最近 7 天最值得关注的机构观点，按跨机构热度、机构权威度与新鲜度排序，每条都链接到原始研报。",
  );
  return {
    ...canonical(page > 1 ? `/institutions?page=${page}` : "/institutions", locale),
    title: { absolute: title },
    description: clamp(description, 158),
    openGraph: { type: "website", title, description, url: localizedUrl("/institutions", locale), locale, images: [{ url: ogImage("Views", title, tr(locale, "Ranked by heat, authority and freshness", "按热度、机构权威与新鲜度排序")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

const TYPE_ZH: Record<string, string> = {
  forecast: "预测", target: "目标", direction: "方向", conditional: "条件观点",
  risk: "风险", rationale: "逻辑", market_impact: "市场影响",
};

function directionLabel(direction: string, locale: Locale) {
  if (locale === "en") return direction;
  return ({ bullish: "看多", bearish: "看空", neutral: "中性", conditional: "条件性" } as Record<string, string>)[direction] ?? direction;
}

export default async function ViewsPage(props: { searchParams: Promise<{ page?: string }> }) {
  const searchParams = await props.searchParams;
  const locale = await getLocale();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const take = 50;
  // Only the last VIEW_WINDOW_DAYS are rankable, so bound the fetch to that window instead
  // of loading the whole corpus; ranking still happens in memory while the set is small.
  const windowStart = new Date(Date.now() - VIEW_WINDOW_DAYS * 864e5);
  // Select only the columns ranking and this list actually read. `include: { article }`
  // pulled the whole article row — `rawText` is the entire cleaned body, tens of KB each —
  // once per view, so an article with N views loaded its body N times. Across a week of the
  // full corpus that is hundreds of MB of text the page never renders, which overran the
  // container's heap and took the process down (the page 502s while everything else briefly
  // does too). None of those large columns are needed here.
  const allViews = await prisma.atomicView.findMany({
    where: { article: publicationReadyWhere({ publishedAt: { gte: windowStart } }) },
    select: {
      id: true, articleId: true, viewEn: true, viewZh: true, type: true, asset: true,
      assetTicker: true, topic: true, direction: true, timeHorizon: true, value: true,
      importance: true, sourceQuote: true,
      article: {
        select: {
          slug: true, publishedAt: true, createdAt: true, institutionId: true,
          institution: { select: { slug: true, name: true, rating: true, authorityScore: true } },
        },
      },
    },
  });
  // Every publisher that has at least one report, not only the ones active this week.
  // The stream above is ranked by heat, so a house writing less often never appeared on it —
  // and fourteen of the fifty institution pages had no link from any hub at all, which left
  // their only inbound path their own reports. This is the index that gives them one.
  const publishers = await prisma.institution.findMany({
    where: { articles: { some: publicationReadyWhere() } },
    orderBy: { name: "asc" },
    select: { slug: true, name: true, country: true },
  });
  const ranked = clusterViewsNewestFirst(rankAtomicViews(allViews, new Date(), marketEvents as MarketEvent[]));
  const total = ranked.length;
  const views = ranked.slice((page - 1) * take, page * take);
  const pages = Math.max(1, Math.ceil(total / take));

  return (
    <main className="wrap view-stream-wrap">
      <JsonLd data={collectionPageJsonLd(locale, "/institutions", viewsSeoTitle(locale), tr(locale, "Evidence-backed institutional views published in the last seven days.", "最近 7 天发布的、可追溯的机构观点。"), tr(locale, "Institutional market views", "机构市场观点"))} />
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "Views", "观点"), path: "/institutions" }])} />
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Institutional Wire", "机构短讯")}</div>
        <h1>{tr(locale, "Views", "观点")}</h1>
        <p className="sub">{tr(locale, `${total} evidence-backed views published in the latest 7 days, newest first with same-topic and same-event views grouped together.`, `共 ${total} 条最近7天发布的可追溯观点，最新优先，同主题、同事件的观点聚合在一起。`)}</p>
        <p className="sub" style={{ color: "var(--muted)", maxWidth: "72ch" }}>
          {tr(locale, "Each line is one claim extracted from one report: what the publisher expects, in which direction, on which asset, over what horizon. ", "每一条都是从一篇研报中提取的具体主张：哪家机构、对哪个资产、什么方向、什么期限。")}
          <Link href={localePath(locale, "/methodology")}>{tr(locale, "How views are extracted", "观点如何提取")}</Link>
          {" · "}
          <Link href={localePath(locale, "/markets")}>{tr(locale, "By asset", "按资产查看")}</Link>
          {" · "}
          <Link href={localePath(locale, "/topics")}>{tr(locale, "By topic", "按主题查看")}</Link>
        </p>
      </div>

      <section className="view-flash-list" aria-label={tr(locale, "Latest institutional views", "最新机构观点")}>
        {views.map((view, viewIndex) => {
          const tone = view.direction === "bullish" ? "bull" : view.direction === "bearish" ? "bear" : "neu";
          const copy = locale === "zh-CN" ? localizeChineseContent(view.viewZh) : view.viewEn;
          const displayValue = localizedDataValue(view.value, locale);
          return (
            <article className="view-flash" key={view.id}>
              <div className="view-rank"><b>#{(page - 1) * take + viewIndex + 1}</b><time dateTime={view.article.publishedAt.toISOString()} title={formatDate(view.article.publishedAt, locale)}>{relTime(articleTimestamp(view.article.publishedAt, view.article.createdAt), locale)}</time></div>
              <div className="view-flash-main">
                <div className="view-flash-meta">
                  <Link href={localePath(locale, `/institution/${view.article.institution.slug}`)}>{institutionName(view.article.institution.name, locale)}</Link>
                  <span className={`chip ${tone}`}>{directionLabel(view.direction, locale)}</span>
                  <span className="chip gray">{locale === "zh-CN" ? TYPE_ZH[view.type] ?? domainTerm(view.type, locale) : domainTerm(view.type, locale)}</span>
                  {view.assetTicker ? <Link href={localePath(locale, assetPath(view.assetTicker))} className="chip acc">{assetName(view.asset, locale, view.assetTicker, "相关资产")} · {view.assetTicker}</Link> : <span className="chip acc">{assetName(view.asset, locale, null, "相关资产")}</span>}
                  {view.matchedEvent && <a href={view.matchedEvent.sourceUrl} target="_blank" rel="noopener noreferrer" className="chip bear">{locale === "zh-CN" ? view.matchedEvent.titleZh : view.matchedEvent.titleEn}</a>}
                  <span className="view-horizon">{domainTerm(view.timeHorizon, locale, "时间范围见观点")}</span>
                </div>
                <div className="ai-analysis-label">{tr(locale, "AI-generated analytical summary · not a direct translation", "AI 观点摘要 · 非原文直译")}</div>
                <h2><Link href={localePath(locale, researchPath(view.article))}>{copy}</Link></h2>
                <div className="view-flash-foot">
                  {displayValue && <b>{displayValue}</b>}
                  <span>{domainTerm(view.topic, locale, "相关主题")}</span><span>{"★".repeat(view.importance)}</span>
                  <span title={tr(locale, "7-day cross-institution and event heat", "7天跨机构与事件热度")}>{tr(locale, "Heat", "热度")} {view.heatScore}{view.crossInstitutionCount > 1 ? ` · ${view.crossInstitutionCount}${tr(locale, " inst.", "家机构")}` : ""}</span>
                  <span title={tr(locale, "Institution authority and rating", "机构权威度与评级")}>{tr(locale, "Authority", "机构")} {view.authorityScore}</span>
                  <span title={tr(locale, "Exponential recency score", "指数衰减新鲜度")}>{tr(locale, "Fresh", "新鲜")} {view.freshnessScore}</span>
                  {view.sourceQuote && view.sourceQuote.trim() !== copy.trim() && <details><summary>{tr(locale, "English source evidence", "英文原文证据（非上文直译）")}</summary><blockquote>{view.sourceQuote}</blockquote></details>}
                </div>
              </div>
            </article>
          );
        })}
        {views.length === 0 && <div className="empty-state">{tr(locale, "No atomic views have been extracted yet.", "暂未提取出原子观点。")}</div>}
      </section>

      {pages > 1 && <nav className="pagination" aria-label={tr(locale, "View pages", "观点分页")}>
        {page > 1 && <Link href={localePath(locale, `/institutions?page=${page - 1}`)} rel="prev">← {tr(locale, "Previous", "上一页")}</Link>}
        <span>{tr(locale, `Page ${page} / ${pages}`, `第 ${page} / ${pages} 页`)}</span>
        {page < pages && <Link href={localePath(locale, `/institutions?page=${page + 1}`)} rel="next">{tr(locale, "Next", "下一页")} →</Link>}
      </nav>}

      {publishers.length > 0 && <section className="blk" aria-label={tr(locale, "All publishing institutions", "全部机构")}>
        <h2 className="section-t">{tr(locale, `All ${publishers.length} publishing institutions`, `全部 ${publishers.length} 家机构`)}</h2>
        <div className="tag-row">
          {publishers.map((publisher) => (
            <Link key={publisher.slug} className="chip gray" href={localePath(locale, `/institution/${publisher.slug}`)}>
              {institutionName(publisher.name, locale)}{publisher.country ? ` · ${publisher.country}` : ""}
            </Link>
          ))}
        </div>
      </section>}
      <section className="blk" aria-label={tr(locale, "Subject institutions", "内容涉及机构")}>
        <h2 className="section-t">{tr(locale, "Central banks and public institutions", "央行与公共机构")}</h2>
        <p className="sub">{tr(locale, "These links group reports by the institution discussed in the content, not by who published the report.", "以下链接按内容讨论的机构聚合，与研报发布机构分开。")}</p>
        <div className="tag-row">
          {taxonomy.institutions.map((subject) => <Link key={subject.key} className="chip gray" href={localePath(locale, `/institution/${subject.key}`)}>{locale === "zh-CN" ? subject.nameZh : subject.nameEn}</Link>)}
        </div>
      </section>
    </main>
  );
}
