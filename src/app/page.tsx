import type { Metadata } from "next";
import Link from "next/link";
import { feedPulse, importantReleasesThisWeek, latestFeed, mostActive } from "@/lib/queries";
import { FeedCard } from "./_components/ui";
import SearchBox from "./_components/SearchBox";
import LiveFeed from "./_components/LiveFeed";
import { domainTerm, getLocale, institutionName, tr, localePath } from "@/lib/i18n";
import { beijingDateTime } from "@/lib/macro/presentation";
import { JsonLd, canonical, homeSeoTitle, localizedUrl, ogImage, organizationJsonLd, siteJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const description = tr(
    locale,
    "Track market views from global banks and asset managers. Compare institutional forecasts, consensus signals and changes across equities, FX, commodities, rates and crypto.",
    "追踪全球银行和资产管理机构的公开研究，比较股票、外汇、大宗商品、利率及加密资产的机构观点、共识变化与原始证据。",
  );
  return {
    title: { absolute: homeSeoTitle(locale) },
    description,
    ...canonical("/", locale),
    openGraph: { type: "website", title: tr(locale, "Tlines Institutional Intelligence", "Tlines 全球机构情报"), description, url: localizedUrl("/", locale), locale, images: [{ url: ogImage("Institutional Intelligence", "Institutional Research & Market Signals", "Traceable, source-linked views"), width: 1200, height: 630 }] },
  };
}

export default async function Home() {
  const locale = await getLocale();
  const [feed, active, thisWeek, pulse] = await Promise.all([
    latestFeed(8, locale),
    mostActive(30, 6),
    importantReleasesThisWeek(5),
    feedPulse(),
  ]);

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
        <h1>{tr(locale, "Tlines Institutional Intelligence", "Tlines 全球机构情报")}</h1>
        <p className="sub">{tr(locale, "Turn the research produced daily by global financial institutions into comparable, trackable and searchable signals.", "把全球金融机构每天产生的研报，转换成可比较、可追踪、可检索的信号。")}</p>
        <SearchBox locale={locale} placeholder={tr(locale, "Search institutions, assets, research and views…", "搜索机构、资产、研报和观点……")} ariaLabel={tr(locale, "Search the site", "全站搜索")} />
      </section>

      <div className="grid-main">
        <div>
          <div className="section-t">{tr(locale, "Latest Institutional Views", "最新机构观点")}</div>
          <div className="feed">
            {feed.map((a) => <FeedCard key={a.id} a={a} locale={locale} />)}
          </div>
        </div>
        <div>
          <div className="side-block">
            <div className="section-t">{tr(locale, "Key Data This Week · Beijing time", "本周重要数据 · 北京时间")}</div>
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
            <div className="section-t">{tr(locale, "Most Active · 30d", "最活跃机构 · 30天")}</div>
            <div className="rowlist">
              {active.map((x) => (
                <Link key={x.inst.id} href={localePath(locale, `/institution/${x.inst.slug}`)} className="r">
                  <span className="inst">{institutionName(x.inst.name, locale)}</span>
                  <span className="n">{x.count}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="side-block">
            <div className="section-t">{tr(locale, "Trending Topics", "热门话题")}</div>
            <div className="tag-row">
              {["Fed", "AI Capex", "Nvidia", "Gold", "Oil", "USD", "Treasuries", "China"].map((t) => (
                <span key={t} className="chip gray">{domainTerm(t, locale)}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
