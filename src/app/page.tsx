import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { feedPulse, importantReleasesThisWeek, latestFeed, mostActive } from "@/lib/queries";
import { FeedCard } from "./_components/ui";
import SearchBox from "./_components/SearchBox";
import LiveFeed from "./_components/LiveFeed";
import { domainTerm, getLocale, institutionName, tr, localePath } from "@/lib/i18n";
import { beijingDateTime } from "@/lib/macro/presentation";
import { assetPath } from "@/lib/assetPath";
import { listIndexableTopics, topicPath } from "@/lib/topics";
import { JsonLd, canonical, clamp, homeSeoTitle, localizedUrl, ogImage, organizationJsonLd, siteJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  // Clamped, not sliced: the English sentence runs to 195 characters, and a description that
  // stops mid-word reads as broken in a result.
  const description = clamp(tr(
    locale,
    "Compare what banks and asset managers say about gold, oil, rates, FX, equities and crypto: the consensus, every published target, what changed this week, and the original report behind each view.",
    "逐家比较银行与资管机构对黄金、原油、利率、外汇、股票与加密资产的公开观点：共识方向、每条目标价、本周变化，以及每个观点背后的原始研报。",
  ), 158);
  return {
    title: { absolute: homeSeoTitle(locale) },
    description,
    ...canonical("/", locale),
    openGraph: { type: "website", title: tr(locale, "Tlines Institutional Intelligence", "Tlines 全球机构情报"), description, url: localizedUrl("/", locale), locale, images: [{ url: ogImage("Institutional Intelligence", "Institutional Research & Market Signals", "Traceable, source-linked views"), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: tr(locale, "Tlines Institutional Intelligence", "Tlines 全球机构情报"), description, images: [ogImage("Institutional Intelligence", "Institutional Research & Market Signals", "Traceable, source-linked views")] },
  };
}

export default async function Home() {
  const locale = await getLocale();
  const [feed, active, thisWeek, pulse, topics, institutionCount, reportCount, assets] = await Promise.all([
    latestFeed(8, locale),
    mostActive(30, 6),
    importantReleasesThisWeek(5),
    feedPulse(),
    listIndexableTopics(),
    prisma.institution.count({ where: { articles: { some: publicationReadyWhere() } } }),
    prisma.article.count({ where: publicationReadyWhere() }),
    // The same coverage rule the markets hub applies, so the count here is the count there.
    prisma.asset.findMany({
      where: { articleAssets: { some: { article: publicationReadyWhere() } } },
      orderBy: { name: "asc" },
      select: { ticker: true, name: true, articleAssets: { where: { article: publicationReadyWhere() }, select: { article: { select: { institutionId: true } } } } },
    }),
  ]);
  const coveredAssets = assets
    .map((asset) => ({ ...asset, institutions: new Set(asset.articleAssets.map((item) => item.article.institutionId)).size, reports: asset.articleAssets.length }))
    .filter((asset) => asset.reports >= 2 && asset.institutions >= 2);

  return (
    <main className="wrap home">
      <JsonLd data={organizationJsonLd(locale)} />
      <JsonLd data={siteJsonLd(locale, tr(locale, "Institutional research turned into comparable, traceable market signals.", "把机构研报转换为可比较、可追踪的市场信号。"))} />
      <LiveFeed
        initial={pulse}
        label={tr(locale, "New research", "有新研报")}
        ariaLabel={tr(locale, "Load newly published research", "载入新发布的研报")}
      />
      <section className="hero home-hero">
        <div className="home-hero-copy">
          <div className="eyebrow home-kicker"><span aria-hidden="true" />{tr(locale, "Institutional intelligence, with receipts", "有原始依据的全球机构情报")}</div>
          <h1>
            {tr(locale, "Institutional research,", "把机构研报，")}<br />
            <span>{tr(locale, "turned into market signals.", "变成市场信号。")}</span>
          </h1>
          <p className="sub">{tr(locale, "Compare what global banks and asset managers are saying, see where they agree, and trace every view back to its original report.", "比较全球银行与资管机构的公开观点，看清共识与分歧，并把每一条结论追溯到原始研报。")}</p>
          <SearchBox locale={locale} placeholder={tr(locale, "Search an institution, asset, topic or view…", "搜索机构、资产、主题或观点……")} ariaLabel={tr(locale, "Search the site", "全站搜索")} />
        </div>
        <div className="home-hero-stats" aria-label={tr(locale, "Coverage", "收录概览")}>
          <Link href={localePath(locale, "/research")} className="home-hero-stat"><strong>{reportCount.toLocaleString(locale)}</strong><span>{tr(locale, "source-linked reports", "篇可溯源研报")}</span></Link>
          <Link href={localePath(locale, "/institutions")} className="home-hero-stat"><strong>{institutionCount}</strong><span>{tr(locale, "publishing houses", "家发布机构")}</span></Link>
          <Link href={localePath(locale, "/markets")} className="home-hero-stat"><strong>{coveredAssets.length}</strong><span>{tr(locale, "covered assets", "个覆盖资产")}</span></Link>
          <Link href={localePath(locale, "/topics")} className="home-hero-stat"><strong>{topics.length}</strong><span>{tr(locale, "research topics", "个研究主题")}</span></Link>
        </div>
      </section>

      <div className="grid-main home-stream">
        <section>
          <div className="home-section-head">
            <div><span className="eyebrow">{tr(locale, "Research ledger", "研报账本")}</span><h2>{tr(locale, "Latest institutional views", "最新机构观点")}</h2></div>
            <Link href={localePath(locale, "/research")}>{tr(locale, "View all", "查看全部")} <span aria-hidden="true">→</span></Link>
          </div>
          <div className="feed">
            {feed.map((a) => <FeedCard key={a.id} a={a} locale={locale} />)}
          </div>
        </section>
        <aside className="home-sidebar">
          <div className="side-block">
            <h2 className="section-t">{tr(locale, "Key Data This Week · Beijing time", "本周重要数据 · 北京时间")}</h2>
            <div className="rowlist">
              {thisWeek.map((release) => (
                <Link key={release.id} href={localePath(locale, `/macro/release/${release.id}`)} className="r" style={{ textDecoration: "none" }}>
                  <span className="inst">{locale === "zh-CN" ? release.titleZh ?? release.titleEn : release.titleEn}<small className="mono" style={{ display: "block", color: "var(--faint)" }}>{release.countryCode} · {"●".repeat(release.importance)}</small></span>
                  <span className="mono" style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>{beijingDateTime(release.scheduledAt, locale)}</span>
                </Link>
              ))}
              {thisWeek.length === 0 && <div className="r"><span style={{ color: "var(--muted)" }}>{tr(locale, "No high-impact releases left this week.", "本周暂无重要数据发布。")}</span></div>}
            </div>
          </div>
          <div className="side-block">
            <h2 className="section-t">{tr(locale, "Most Active · 30d", "最活跃机构 · 30天")}</h2>
            <div className="rowlist">
              {active.map((x) => (
                <Link key={x.inst.id} href={localePath(locale, `/institution/${x.inst.slug}`)} className="r">
                  <span className="inst">{institutionName(x.inst.name, locale)}</span>
                  <span className="n">{x.count}</span>
                </Link>
              ))}
            </div>
          </div>
          {topics.length > 0 && (
            <div className="side-block">
              <h2 className="section-t">{tr(locale, "Topics institutions are writing about", "机构正在讨论的主题")}</h2>
              <div className="tag-row">
                {topics.slice(0, 8).map((topic) => (
                  <Link key={topic.key} href={localePath(locale, topicPath(topic.key))} className="chip gray">
                    {locale === "zh-CN" ? topic.labelZh : topic.labelEn}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/*
        The block a crawler reads first and a reader reads last. It states what this is, what
        feeds it and what can be looked up, using counts taken from the database on this
        request rather than a number written into the markup.
      */}
      <section className="home-about">
        <div className="home-about-intro">
          <div>
            <span className="eyebrow">{tr(locale, "What Tlines does", "Tlines 在做什么")}</span>
            <h2>{tr(locale, "Not another news feed. A traceable ledger of institutional views.", "不是再做一个资讯流，而是建立一份可追踪的机构观点账本。")}</h2>
          </div>
          <p>{tr(locale,
            "Tlines turns scattered public research into comparable data. Every conclusion keeps its source, every target and direction can be compared, and every change remains visible.",
            "Tlines 把散落在机构网站里的公开研报整理成可比较的数据。每条结论保留来源，每个目标价与方向都能横向比较，每次观点变化都有记录。")} </p>
        </div>

        <div className="home-process-head">
          <span className="eyebrow">{tr(locale, "From document to decision", "从文档到决策")}</span>
          <h2>{tr(locale, "One report, four useful states", "一篇研报，经过四步成为信号")}</h2>
        </div>
        <div className="home-process">
          {([
            [tr(locale, "Research", "研报"), tr(locale, "Published reports are collected from public institutional sources, with the address each one came from kept on the page.", "从机构公开发布渠道采集研报，并在页面上保留每一篇的原始地址。")],
            [tr(locale, "Structured", "结构化"), tr(locale, "Each report is reduced to a one-sentence conclusion, its key arguments, the numbers that carry them, and its main risks.", "每篇研报被提炼为一句话结论、关键论点、支撑数字与主要风险。")],
            [tr(locale, "Consensus", "共识"), tr(locale, "Views on the same asset are combined into a direction, a target distribution and a record of every change of view.", "同一资产上的观点被汇总为方向、目标价分布，以及每一次观点变化的记录。")],
            [tr(locale, "Signal", "信号"), tr(locale, "What changed, and which data releases and central-bank decisions are coming next.", "什么发生了变化，以及接下来有哪些数据发布与央行决定。")],
          ] as Array<[string, string]>).map(([term, definition], index) => (
            <article key={term}>
              <span className="mono">{String(index + 1).padStart(2, "0")}</span>
              <h3>{term}</h3>
              <p>{definition}</p>
            </article>
          ))}
        </div>

        <div className="home-explore">
          <div>
            <span className="eyebrow">{tr(locale, "Explore the ledger", "从哪里开始")}</span>
            <h2>{tr(locale, "Follow the market from the angle you care about.", "从你关心的角度进入市场。")}</h2>
            <p>{tr(locale, "Start with an asset, an institution, a topic, or the next macro event.", "从资产、机构、主题，或下一项宏观数据开始。")}</p>
          </div>
          <nav className="home-explore-links" aria-label={tr(locale, "Explore Tlines", "探索 Tlines")}>
            <Link href={localePath(locale, "/markets")}><strong>{tr(locale, "Markets", "资产共识")}</strong><span>{coveredAssets.length} {tr(locale, "assets", "个资产")} →</span></Link>
            <Link href={localePath(locale, "/institutions")}><strong>{tr(locale, "Institutions", "机构档案")}</strong><span>{institutionCount} {tr(locale, "publishers", "家机构")} →</span></Link>
            <Link href={localePath(locale, "/topics")}><strong>{tr(locale, "Topics", "主题脉络")}</strong><span>{topics.length} {tr(locale, "topics", "个主题")} →</span></Link>
            <Link href={localePath(locale, "/macro")}><strong>{tr(locale, "Macro", "经济日历")}</strong><span>{tr(locale, "Data & policy", "数据与政策")} →</span></Link>
            <Link href={localePath(locale, "/research")}><strong>{tr(locale, "Research", "全部研报")}</strong><span>{reportCount.toLocaleString(locale)} {tr(locale, "reports", "篇研报")} →</span></Link>
            <Link href={localePath(locale, "/market-themes")}><strong>{tr(locale, "Themes", "交易主线")}</strong><span>{tr(locale, "Narratives in motion", "正在变化的叙事")} →</span></Link>
          </nav>
        </div>

        <div className="home-asset-line">
          <span>{tr(locale, "Popular coverage", "热门覆盖")}</span>
          <div>{coveredAssets.slice(0, 12).map((asset) => <Link key={asset.ticker} href={localePath(locale, assetPath(asset.ticker))}>{domainTerm(asset.name, locale)}</Link>)}</div>
        </div>

        <div className="home-verification">
          <div><span aria-hidden="true">✓</span><p><strong>{tr(locale, "Built to be checked", "经得起核对")}</strong>{tr(locale, "Every view links back to its original report. Our extraction rules, accepted sources, AI use and correction process are public.", "每条观点都链接回原始研报；提取规则、来源标准、AI 使用方式与纠错流程全部公开。")}</p></div>
          <nav aria-label={tr(locale, "Verification policies", "验证与政策")}>
            <Link href={localePath(locale, "/methodology")}>{tr(locale, "Methodology", "方法论")}</Link>
            <Link href={localePath(locale, "/sources")}>{tr(locale, "Sources", "来源政策")}</Link>
            <Link href={localePath(locale, "/ai-usage")}>{tr(locale, "AI usage", "AI 使用说明")}</Link>
            <Link href={localePath(locale, "/corrections")}>{tr(locale, "Corrections", "更正机制")}</Link>
          </nav>
        </div>
      </section>
    </main>
  );
}
