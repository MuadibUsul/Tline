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
    <main className="wrap">
      <JsonLd data={organizationJsonLd(locale)} />
      <JsonLd data={siteJsonLd(locale, tr(locale, "Institutional research turned into comparable, traceable market signals.", "把机构研报转换为可比较、可追踪的市场信号。"))} />
      <LiveFeed
        initial={pulse}
        label={tr(locale, "New research", "有新研报")}
        ariaLabel={tr(locale, "Load newly published research", "载入新发布的研报")}
      />
      <section className="hero">
        <div className="eyebrow">{tr(locale, "Institutional Research, Consensus & Market Signals", "机构研报、市场共识与资产信号")}</div>
        <h1>{tr(locale, "Institutional research, turned into market signals", "把机构研报，变成市场信号")}</h1>
        <p className="sub">{tr(locale, "Turn the research produced daily by global financial institutions into comparable, trackable and searchable signals.", "把全球金融机构每天产生的研报，转换成可比较、可追踪、可检索的信号。")}</p>
        <SearchBox locale={locale} placeholder={tr(locale, "Search institutions, assets, research and views…", "搜索机构、资产、研报和观点……")} ariaLabel={tr(locale, "Search the site", "全站搜索")} />
      </section>

      <div className="grid-main">
        <div>
          <h2 className="section-t">{tr(locale, "Latest Institutional Views", "最新机构观点")}</h2>
          <div className="feed">
            {feed.map((a) => <FeedCard key={a.id} a={a} locale={locale} />)}
          </div>
        </div>
        <div>
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
        </div>
      </div>

      {/*
        The block a crawler reads first and a reader reads last. It states what this is, what
        feeds it and what can be looked up, using counts taken from the database on this
        request rather than a number written into the markup.
      */}
      <section className="blk" style={{ marginTop: 34 }}>
        <h2 className="section-t">{tr(locale, "What Tlines is", "Tlines 是什么")}</h2>
        <p className="sub" style={{ maxWidth: "72ch" }}>
          {tr(locale,
            `Tlines reads the research banks, brokers and asset managers publish publicly, extracts the views inside it — direction, target, horizon and the conditions that would invalidate them — and publishes each report as a structured, source-linked page. Those views are then aggregated per asset, per institution and per topic, so a reader can see where institutions agree, where they diverge, and what changed rather than reading every report. ${reportCount} institutional reports from ${institutionCount} publishing houses are currently indexed.`,
            `Tlines 读取银行、券商与资产管理机构公开发布的研报，提取其中的观点——方向、目标价、期限，以及会使观点失效的条件——并把每篇研报发布为可溯源的结构化页面；再按资产、机构与主题汇总，让读者不必逐篇阅读，也能看到机构在哪里一致、在哪里分歧、以及什么发生了变化。目前收录了来自 ${institutionCount} 家机构的 ${reportCount} 篇研报。`)}
        </p>
        <h2 className="section-t" style={{ marginTop: 22 }}>{tr(locale, "How a report becomes a signal", "一篇研报如何变成信号")}</h2>
        <dl className="rowlist" style={{ display: "grid", gap: 10 }}>
          {([
            [tr(locale, "Research", "研报"), tr(locale, "Published reports are collected from public institutional sources, with the address each one came from kept on the page.", "从机构公开发布渠道采集研报，并在页面上保留每一篇的原始地址。")],
            [tr(locale, "Structured", "结构化"), tr(locale, "Each report is reduced to a one-sentence conclusion, its key arguments, the numbers that carry them, and its main risks.", "每篇研报被提炼为一句话结论、关键论点、支撑数字与主要风险。")],
            [tr(locale, "Consensus", "共识"), tr(locale, "Views on the same asset are combined into a direction, a target distribution and a record of every change of view.", "同一资产上的观点被汇总为方向、目标价分布，以及每一次观点变化的记录。")],
            [tr(locale, "Signal", "信号"), tr(locale, "What changed, and which data releases and central-bank decisions are coming next.", "什么发生了变化，以及接下来有哪些数据发布与央行决定。")],
          ] as Array<[string, string]>).map(([term, definition]) => (
            <div key={term} style={{ display: "grid", gridTemplateColumns: "minmax(88px, auto) 1fr", gap: 12 }}>
              <dt className="mono" style={{ color: "var(--ink-2)" }}>{term}</dt>
              <dd style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>{definition}</dd>
            </div>
          ))}
        </dl>
        <h2 className="section-t" style={{ marginTop: 22 }}>{tr(locale, "What you can look up", "可以查什么")}</h2>
        <div className="tag-row" style={{ marginBottom: 10 }}>
          <Link className="chip gray" href={localePath(locale, "/markets")}>{tr(locale, `${coveredAssets.length} assets`, `${coveredAssets.length} 个资产`)}</Link>
          <Link className="chip gray" href={localePath(locale, "/institutions")}>{tr(locale, `${institutionCount} institutions`, `${institutionCount} 家机构`)}</Link>
          <Link className="chip gray" href={localePath(locale, "/topics")}>{tr(locale, `${topics.length} topics`, `${topics.length} 个主题`)}</Link>
          <Link className="chip gray" href={localePath(locale, "/macro")}>{tr(locale, "economic data", "经济数据")}</Link>
          <Link className="chip gray" href={localePath(locale, "/research")}>{tr(locale, "research feed", "研报流")}</Link>
          <Link className="chip gray" href={localePath(locale, "/market-themes")}>{tr(locale, "market themes", "交易主线")}</Link>
        </div>
        <p className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>
          {coveredAssets.slice(0, 12).map((asset, index) => (
            <span key={asset.ticker}>
              {index > 0 ? " · " : ""}
              <Link href={localePath(locale, assetPath(asset.ticker))}>{domainTerm(asset.name, locale)}</Link>
            </span>
          ))}
        </p>
        <h2 className="section-t" style={{ marginTop: 22 }}>{tr(locale, "How this is verified", "如何验证")}</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, maxWidth: "72ch" }}>
          {tr(locale, "Every view links to the report it came from. The rules used to extract and aggregate views, the sources accepted, how AI is used, and how corrections are handled are all published: ", "每一条观点都链接到它来自的研报。观点提取与汇总的规则、来源收录标准、AI 使用方式与纠错流程均已公开：")}
          <Link href={localePath(locale, "/methodology")}>{tr(locale, "Methodology", "方法论")}</Link>{" · "}
          <Link href={localePath(locale, "/sources")}>{tr(locale, "Sources", "来源政策")}</Link>{" · "}
          <Link href={localePath(locale, "/ai-usage")}>{tr(locale, "AI usage", "AI 使用说明")}</Link>{" · "}
          <Link href={localePath(locale, "/corrections")}>{tr(locale, "Corrections", "更正机制")}</Link>{" · "}
          <Link href={localePath(locale, "/financial-disclaimer")}>{tr(locale, "Disclaimer", "免责声明")}</Link>
        </p>
      </section>
    </main>
  );
}
