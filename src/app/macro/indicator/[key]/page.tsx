import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, getLocale, tr } from "@/lib/i18n";
import { macroDateTime, macroNumber } from "@/lib/macro/presentation";

export const dynamic = "force-dynamic";

export default async function MacroIndicatorPage(props: { params: Promise<{ key: string }> }) {
  const params = await props.params;
  const locale = await getLocale();
  const indicator = await prisma.macroIndicator.findUnique({ where: { canonicalKey: params.key }, include: { seriesSources: { orderBy: { priority: "asc" }, include: { observations: { orderBy: [{ period: "desc" }, { vintageAt: "desc" }], take: 500 } } } } });
  if (!indicator) notFound();
  const observations = indicator.seriesSources.flatMap((source) => source.observations.map((observation) => ({ ...observation, source }))).sort((left, right) => right.period.getTime() - left.period.getTime() || right.vintageAt.getTime() - left.vintageAt.getTime());
  const latest = observations[0];
  return <main className="wrap"><div className="page-head"><div className="eyebrow">{indicator.countryCode} · {indicator.category}</div><h1>{locale === "zh-CN" ? indicator.nameZh ?? indicator.nameEn : indicator.nameEn}</h1><div className="big-score"><span className="num">{macroNumber(latest?.value, locale)}</span><span className="mono">{indicator.unit}</span></div><div className="deltas"><span>{tr(locale, "Frequency", "频率")}: {indicator.frequency}</span><span>{tr(locale, "Seasonal adjustment", "季节调整")}: {indicator.seasonalAdjustment ?? "N/A"}</span><span>{tr(locale, "Updated", "更新")}: {latest ? macroDateTime(latest.fetchedAt, locale) : "N/A"}</span></div><Link href="/macro" className="minibtn" style={{ alignSelf: "flex-start" }}>← {tr(locale, "Economic data", "经济数据")}</Link></div><section className="blk"><div className="section-t">{tr(locale, "History and vintages", "历史与版本")}</div><div className="tbl-wrap"><table><thead><tr><th>{tr(locale, "Period", "数据期")}</th><th>{tr(locale, "Value", "数值")}</th><th>{tr(locale, "Provider", "提供方")}</th><th>{tr(locale, "Vintage", "版本时间")}</th><th>{tr(locale, "Revision", "修订")}</th><th>{tr(locale, "Status", "状态")}</th><th>{tr(locale, "Source", "来源")}</th></tr></thead><tbody>{observations.map((row) => <tr key={row.id}><td className="mono-cell">{formatDate(row.period, locale)}</td><td className="mono-cell">{row.value.toString()}</td><td>{row.source.provider}</td><td className="mono-cell">{macroDateTime(row.vintageAt, locale)}</td><td className="mono-cell">#{row.revisionNo}{row.isInitial ? ` · ${tr(locale, "initial", "初值")}` : ""}</td><td>{row.status}</td><td>{row.source.sourceUrl ? <a href={row.source.sourceUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Official source ↗", "官方来源 ↗")}</a> : "N/A"}</td></tr>)}</tbody></table></div></section></main>;
}
