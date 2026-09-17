import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstitutionAccuracy } from "@/lib/forecast";
import { assetName, formatDate, getLocale, institutionName, tr, localePath } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { breadcrumbJsonLd, canonical, clamp, datasetJsonLd, JsonLd, noIndex } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const locale = await getLocale();
  const institution = await prisma.institution.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!institution) return { title: tr(locale, "Institution not found", "机构未找到"), ...noIndex };
  const name = institutionName(institution.name, locale);
  // A record with nothing settled is the same sentence on every institution's page. Until
  // this one has a forecast to show, it is a duplicate of fifty others and asks to be left
  // out of the index rather than crawled, compared and dropped.
  const settled = await prisma.forecast.count({ where: { institutionId: institution.id, status: "settled" } });
  return {
    // Absolute: the layout's " · Tlines" suffix would push a 60-character subject past the
    // width a result shows, and the institution's name in front is what a searcher matches.
    title: { absolute: clamp(tr(locale, `${name} forecast accuracy — how its calls settled`, `${name}预测准确率：已结算观点的实际结果`), 60) },
    ...(settled === 0 ? { robots: { index: false, follow: true } } : {}),
    description: tr(
      locale,
      `How ${name}'s published forecasts have settled against what actually happened: direction, target and error, forecast by forecast.`,
      `${name}已发布的预测与实际结果的对照:方向、目标价与误差,逐条可查。`,
    ),
    ...canonical(`/institution/${slug}/accuracy`, locale),
  };
}

function value(value: number | null) {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default async function AccuracyPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const locale = await getLocale();
  const data = await getInstitutionAccuracy(params.slug);
  if (!data) notFound();
  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Forecast Accuracy", "预测准确率")}</div>
        <h1>{tr(locale, `${institutionName(data.institution.name, locale)} — forecast accuracy`, `${institutionName(data.institution.name, locale)}：预测准确率`)}</h1>
        <div className="deltas">
          <span>{tr(locale, "Settled", "已结算")} <b className="mono">{data.forecasts.length}</b></span>
          <span>{tr(locale, "Awaiting prices", "等待价格")} <b className="mono">{data.pending}</b></span>
          <span>{tr(locale, "Direction", "方向") } <b className="mono">{data.directionAccuracy === null ? "—" : `${(data.directionAccuracy * 100).toFixed(1)}%`}</b></span>
          <span>{tr(locale, "Valid direction sample", "有效方向样本")} <b className="mono">{data.directionSample}</b></span>
          <span>{tr(locale, "Excluded", "已排除")} <b className="mono">{data.excluded + data.outOfScope}</b></span>
          <span>{tr(locale, "Mean target error", "平均目标误差")} <b className="mono">{data.meanPercentageError === null ? "—" : `${data.meanPercentageError.toFixed(2)}%`}</b></span>
        </div>
        <Link className="minibtn" href={localePath(locale, `/institution/${params.slug}`)}>← {tr(locale, "Institution", "机构")}</Link>
      </div>

      <JsonLd data={breadcrumbJsonLd(locale, [
        { name: tr(locale, "Institutions", "机构"), path: "/institutions" },
        { name: institutionName(data.institution.name, locale), path: `/institution/${params.slug}` },
        { name: tr(locale, "Forecast accuracy", "预测准确率"), path: `/institution/${params.slug}/accuracy` },
      ])} />
      {data.forecasts.length > 0 && <JsonLd data={datasetJsonLd(locale, `/institution/${params.slug}/accuracy`, tr(locale, `${data.institution.name} settled forecast record`, `${data.institution.name} 已结算预测记录`), tr(locale, `Published forecasts by ${data.institution.name}, settled against the first same-source observation on or after the target date. ${data.forecasts.length} settled calls.`, `${data.institution.name} 已发布预测，按目标日期当天或之后同一来源的首个观测值结算，共 ${data.forecasts.length} 条。`))} />}

      <p className="sub" style={{ maxWidth: "72ch", color: "var(--muted)" }}>
        {tr(locale,
          `Every forecast below was published publicly by ${data.institution.name} with a stated target and date. Tlines records the first same-source observation on or after the target date, marks the call settled, and does not adjust the record afterwards. Calls that could not be settled are counted as excluded above rather than dropped silently.`,
          `下列每一条预测均由 ${data.institution.name} 公开发布，并带有明确的目标价与日期。Tlines 取目标日期当天或之后同一来源的首个观测值进行结算，且事后不调整记录；无法结算的判断计入上方"已排除"，而不是静默丢弃。`)}
        {" "}
        <Link href={localePath(locale, "/methodology")}>{tr(locale, "Settlement method", "结算方法")}</Link>
        {" · "}
        <Link href={localePath(locale, "/corrections")}>{tr(locale, "Dispute a record", "对记录提出异议")}</Link>
      </p>

      <section className="blk">
        <h2 className="section-t">{tr(locale, "Settled forecasts", "已结算预测")}</h2>
        {data.forecasts.length ? <div className="tbl-wrap"><table>
          <thead><tr><th>{tr(locale, "Asset", "资产")}</th><th>{tr(locale, "Forecast", "预测值")}</th><th>{tr(locale, "Actual", "实际值")}</th><th>{tr(locale, "Direction", "方向")}</th><th>{tr(locale, "Error", "误差")}</th><th>{tr(locale, "Target date", "目标日期")}</th></tr></thead>
          <tbody>{data.forecasts.map((forecast) => <tr key={forecast.id}>
            <td className="inst">{assetName(forecast.asset.name, locale, forecast.asset.ticker)}</td>
            <td className="mono-cell">{value(forecast.targetValue)}</td>
            <td className="mono-cell">{value(forecast.actualValue)}</td>
            <td>{forecast.directionCorrect === null ? "—" : <span className={`chip ${forecast.directionCorrect ? "bull" : "bear"}`}>{forecast.directionCorrect ? tr(locale, "Correct", "正确") : tr(locale, "Miss", "未命中")}</span>}</td>
            <td className="mono-cell">{forecast.percentageError === null ? "—" : `${forecast.percentageError.toFixed(2)}%`}</td>
            <td className="mono-cell">{forecast.targetDate ? formatDate(forecast.targetDate, locale) : "—"}</td>
          </tr>)}</tbody>
        </table></div> : <div className="empty-state">{tr(locale, "No forecasts have enough licensed price observations to settle yet.", "暂无具备足够授权价格观测值、可供结算的预测。")}</div>}
      </section>
      {data.directionInterval && <p className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>{tr(locale, `Wilson 95% interval: ${(data.directionInterval.low * 100).toFixed(1)}%–${(data.directionInterval.high * 100).toFixed(1)}%. ${data.duplicateCount} repeated same-target report(s) are excluded from independent metrics.`, `Wilson 95% 区间：${(data.directionInterval.low * 100).toFixed(1)}%–${(data.directionInterval.high * 100).toFixed(1)}%。${data.duplicateCount} 条同目标重复报告不计入独立统计。`)}</p>}
      {data.outOfScope > 0 && <p className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>
        {tr(
          locale,
          `${data.outOfScope} rate and macro calls are excluded from this score. "Bullish on 10Y Treasuries" means yields fall, and a policy or inflation stance has no price to settle against, so scoring them against the available series would invert the verdict rather than measure it.`,
          `另有 ${data.outOfScope} 条利率与宏观类判断不纳入本评分。"看多十年期美债"指的是收益率下行，而政策或通胀立场本身没有可结算的价格；用现有序列去打分会得出方向相反的结论，而不是真实的准确率。`,
        )}
      </p>}

      <p className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>
        {tr(locale, "Method: first same-source observation on/after target date, with a matching observation on/before forecast date; maximum gap is configurable and defaults to 7 days.", "方法：取目标日期当天或之后同一来源的首个观测值，并匹配预测日期当天或之前的观测值；最大间隔可配置，默认 7 天。")}
      </p>
    </main>
  );
}
