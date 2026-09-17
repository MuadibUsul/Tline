import type { Metadata } from "next";
import { JsonLd, breadcrumbJsonLd, canonical, collectionPageJsonLd, itemListJsonLd, localizedUrl, macroSeoTitle, ogImage } from "@/lib/seo";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate, getLocale, tr, localePath } from "@/lib/i18n";
import { beijingDateTime, unitLabel } from "@/lib/macro/presentation";
import ReleaseSpotlight, { type SpotlightRelease } from "./ReleaseSpotlight";
import { authorizedExpectationIds } from "@/lib/macro/expectationUse";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = macroSeoTitle(locale);
  const description = tr(
    locale,
    "Scheduled releases with the consensus institutions expected before the print, the figures as published, every revision, and which banks forecast what.",
    "已排期的数据发布：发布前机构预期的共识、实际公布值、后续修订，以及各家银行的预测。",
  );
  return {
    ...canonical("/macro", locale),
    title: { absolute: title },
    description,
    openGraph: { type: "website", title, description, url: localizedUrl("/macro", locale), locale, images: [{ url: ogImage("Economic Data", title, tr(locale, "Releases, consensus and institutional forecasts", "发布、共识与机构预测")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

const toNum = (value: { toString(): string } | null | undefined) => (value === null || value === undefined ? null : Number(value.toString()));

const CATEGORY_ORDER = ["POLICY", "INFLATION", "GROWTH", "LABOR", "LIQUIDITY"];
const CATEGORY_ZH: Record<string, string> = { POLICY: "货币政策", INFLATION: "通胀", GROWTH: "增长", LABOR: "就业", LIQUIDITY: "流动性" };
const dec = (value: { toString(): string } | null | undefined) => (value === null || value === undefined ? "—" : value.toString());

export default async function MacroPage() {
  const locale = await getLocale();
  const nm = (en: string, zh?: string | null) => (locale === "zh-CN" ? zh ?? en : en);
  const now = new Date();

  const [calendar, indicators] = await Promise.all([
    prisma.macroRelease.findMany({
      where: { scheduledAt: { gte: new Date(now.getTime() - 3 * 864e5), lte: new Date(now.getTime() + 14 * 864e5) }, importance: { gte: 3 } },
      orderBy: { scheduledAt: "asc" },
      take: 30,
      include: { values: { take: 1, include: { indicator: true, consensusExpectation: true } } },
    }),
    prisma.macroIndicator.findMany({
      where: { enabled: true },
      orderBy: [{ importance: "desc" }, { nameEn: "asc" }],
      include: { seriesSources: { where: { enabled: true }, orderBy: { priority: "asc" }, include: { observations: { orderBy: [{ period: "desc" }, { vintageAt: "desc" }], take: 2 } } } },
    }),
  ]);

  const rows = indicators.map((indicator) => {
    const source = indicator.seriesSources.find((series) => series.observations.length);
    return { indicator, last: source?.observations[0] ?? null, previous: source?.observations[1] ?? null };
  });
  const categories = [...new Set([...CATEGORY_ORDER, ...rows.map((row) => row.indicator.category)])].filter((category) => rows.some((row) => row.indicator.category === category));

  const publicExpectationIds = await authorizedExpectationIds(calendar.flatMap((release) => release.values.flatMap((value) => value.consensusExpectation ? [value.consensusExpectation] : [])), "public_display");
  const spotlight: SpotlightRelease[] = calendar.map((release) => {
    const value = release.values[0];
    const publicConsensus = Boolean(value?.consensusExpectation && publicExpectationIds.has(value.consensusExpectation.id));
    return {
      id: release.id,
      titleEn: release.titleEn,
      titleZh: release.titleZh,
      countryCode: release.countryCode,
      importance: release.importance,
      scheduledAt: release.scheduledAt.toISOString(),
      releasedAt: release.releasedAt?.toISOString() ?? null,
      status: release.status,
      actual: toNum(value?.actualInitial),
      previous: toNum(value?.revisedPreviousAtRelease ?? value?.previousAtRelease),
      // Only the frozen pre-release survey snapshot is market consensus. Research-mined
      // institution forecasts remain a separate evidence class on the release page.
      consensus: publicConsensus ? toNum(value?.consensusAtRelease) : null,
      consensusCount: 0,
      unit: value?.indicator ? unitLabel(value.indicator.unit, locale) : "",
      analysis: value?.consensusExpectationId && !publicConsensus ? null : (locale === "zh-CN" ? release.analysisZh ?? release.analysisEn : release.analysisEn) ?? null,
    };
  });

  return (
    <main className="wrap">
      <JsonLd data={collectionPageJsonLd(locale, "/macro", macroSeoTitle(locale), tr(locale, "Macro releases, the indicators behind them and the consensus before each print.", "宏观发布、对应指标，以及每次公布前的市场共识。"), tr(locale, "Economic data", "经济数据"))} />
      <JsonLd data={itemListJsonLd(locale, "/macro", tr(locale, "Macro indicators", "宏观指标"), rows.map(({ indicator }) => ({ name: locale === "zh-CN" ? indicator.nameZh ?? indicator.nameEn : indicator.nameEn, path: `/macro/indicator/${indicator.canonicalKey}` })))} />
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "Economic Data", "经济数据"), path: "/macro" }])} />
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Macro", "宏观")}</div>
        <h1>{tr(locale, "Economic Data", "经济数据")}</h1>
        <p className="sub">{tr(locale, `${rows.length} indicators with their release history, and the scheduled prints ahead.`, `${rows.length} 个指标的历史发布序列，以及接下来的发布日程。`)}</p>
        <p className="sub" style={{ color: "var(--muted)", maxWidth: "72ch" }}>
          {tr(locale, "Every release page shows what institutions expected before the print, what was published, and how the figure was revised afterwards. ", "每个发布页都展示发布前机构预期、实际公布值，以及之后的修订情况。")}
          <Link href={localePath(locale, "/topics")}>{tr(locale, "Browse by topic", "按主题浏览")}</Link>
          {" · "}
          <Link href={localePath(locale, "/macro/calendar")}>{tr(locale, "Full calendar", "完整日历")}</Link>
          {" · "}
          <Link href={localePath(locale, "/methodology")}>{tr(locale, "How consensus is computed", "共识如何计算")}</Link>
        </p>
      </div>
      <ReleaseSpotlight releases={spotlight} locale={locale} initialNow={Date.now()} />
      <section className="blk">
        <div className="macro-calendar-head">
          <h2 className="section-t">{tr(locale, "Economic calendar · Beijing time", "经济日历 · 北京时间")}</h2>
          <Link className="minibtn" href={localePath(locale, "/macro/calendar")}>{tr(locale, "Full calendar ↗", "完整日历 ↗")}</Link>
        </div>
        <div className="tbl-wrap"><table>
          <thead><tr>
            <th>{tr(locale, "Time", "时间")}</th>
            <th>{tr(locale, "Country", "国家")}</th>
            <th>{tr(locale, "Event", "事件")}</th>
            <th className="ctr">{tr(locale, "Impact", "重要性")}</th>
            <th className="num-h">{tr(locale, "Actual", "实际")}</th>
            <th className="num-h">{tr(locale, "Previous", "前值")}</th>
            <th className="num-h">{tr(locale, "Consensus", "预期")}</th>
          </tr></thead>
          <tbody>
            {calendar.map((release) => {
              const value = release.values[0];
              const released = release.status === "RELEASED";
              return (
                <tr key={release.id} className={released ? "" : "macro-upcoming"}>
                  <td className="mono-cell">{beijingDateTime(release.scheduledAt, locale)}</td>
                  <td className="mono-cell">{release.countryCode}</td>
                  <td className="inst"><Link href={localePath(locale, `/macro/release/${release.id}`)}>{nm(release.titleEn, release.titleZh)}</Link></td>
                  <td className="ctr" title={`${release.importance}/5`}>{"●".repeat(release.importance)}</td>
                  <td className="mono-cell num"><b>{released ? dec(value?.actualInitial) : tr(locale, "—", "—")}</b></td>
                  <td className="mono-cell num">{dec(value?.revisedPreviousAtRelease ?? value?.previousAtRelease)}</td>
                  <td className="mono-cell num">{value?.consensusExpectation && publicExpectationIds.has(value.consensusExpectation.id) ? dec(value.consensusAtRelease) : "—"}</td>
                </tr>
              );
            })}
            {calendar.length === 0 && <tr><td colSpan={7} className="mono-cell" style={{ color: "var(--muted)" }}>{tr(locale, "No scheduled releases in this window.", "该时间窗内暂无计划发布。")}</td></tr>}
          </tbody>
        </table></div>
      </section>

      <div className="markets-grid">
        {categories.map((category) => (
          <section className="blk" key={category}>
            <h2 className="section-t">{CATEGORY_ZH[category] && locale === "zh-CN" ? CATEGORY_ZH[category] : category}</h2>
            <div className="tbl-wrap"><table>
              <thead><tr>
                <th>{tr(locale, "Indicator", "指标")}</th>
                <th className="num-h">{tr(locale, "Last", "最新")}</th>
                <th className="num-h">{tr(locale, "Prev.", "前值")}</th>
                <th>{tr(locale, "Reference", "参考期")}</th>
              </tr></thead>
              <tbody>
                {rows.filter((row) => row.indicator.category === category).map(({ indicator, last, previous }) => (
                  <tr key={indicator.id}>
                    <td className="inst"><Link href={localePath(locale, `/macro/indicator/${indicator.canonicalKey}`)}>{nm(indicator.nameEn, indicator.nameZh)}</Link><small className="mono" style={{ display: "block", color: "var(--faint)" }}>{unitLabel(indicator.unit, locale)}</small></td>
                    <td className="mono-cell num"><b>{dec(last?.value)}</b></td>
                    <td className="mono-cell num" style={{ color: "var(--faint)" }}>{dec(previous?.value)}</td>
                    <td className="mono-cell">{last ? formatDate(last.period, locale) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        ))}
      </div>
    </main>
  );
}
