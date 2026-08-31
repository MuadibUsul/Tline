import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocale, tr } from "@/lib/i18n";
import { actualText, consensusText, macroDateTime, macroNumber } from "@/lib/macro/presentation";

export const dynamic = "force-dynamic";

export default async function MacroCalendarPage() {
  const locale = await getLocale();
  const from = new Date(Date.now() - 30 * 86_400_000);
  const to = new Date(Date.now() + 180 * 86_400_000);
  const releases = await prisma.macroRelease.findMany({ where: { scheduledAt: { gte: from, lte: to } }, orderBy: { scheduledAt: "asc" }, take: 300, include: { values: { include: { indicator: true } } } });
  type Release = (typeof releases)[number];
  type ReleaseValue = Release["values"][number];
  const rows: Array<{ release: Release; value: ReleaseValue | null }> = [];
  for (const release of releases) {
    if (release.values.length === 0) rows.push({ release, value: null });
    else for (const value of release.values) rows.push({ release, value });
  }
  return <main className="wrap"><div className="page-head"><div className="eyebrow">Macro</div><h1>{tr(locale, "Economic Calendar", "经济日历")}</h1><Link href="/macro" className="minibtn" style={{ alignSelf: "flex-start" }}>← {tr(locale, "Overview", "总览")}</Link></div><section className="blk"><div className="tbl-wrap"><table><thead><tr><th>{tr(locale, "Time", "时间")}</th><th>{tr(locale, "Country / Currency", "国家 / 货币")}</th><th>{tr(locale, "Event", "事件")}</th><th>{tr(locale, "Importance", "重要性")}</th><th>{tr(locale, "Previous", "前值")}</th><th>{tr(locale, "Consensus", "共识")}</th><th>{tr(locale, "Actual", "实际值")}</th><th>{tr(locale, "Revision", "修订")}</th></tr></thead><tbody>{rows.map(({ release, value }, index) => <tr key={value?.id ?? `${release.id}-${index}`}><td className="mono-cell"><Link href={`/macro/release/${release.id}`}>{macroDateTime(release.scheduledAt, locale, release.sourceTimezone)}</Link></td><td className="mono-cell">{release.countryCode} / {release.currency ?? "N/A"}</td><td className="inst"><Link href={`/macro/release/${release.id}`}>{locale === "zh-CN" ? release.titleZh ?? release.titleEn : release.titleEn}{value ? ` · ${locale === "zh-CN" ? value.indicator.nameZh ?? value.indicator.nameEn : value.indicator.nameEn}` : ""}</Link></td><td>{"●".repeat(release.importance)}</td><td className="mono-cell">{macroNumber(value?.previousAtRelease, locale)}</td><td className="mono-cell">{consensusText(value?.consensusAtRelease, locale)}</td><td className="mono-cell">{actualText(value?.actualInitial, release.status === "RELEASED", locale)}</td><td className="mono-cell">{macroNumber(value?.revisedPreviousAtRelease, locale)}</td></tr>)}</tbody></table></div></section></main>;
}
