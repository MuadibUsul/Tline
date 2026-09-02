import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstitutionView } from "@/lib/queries";
import { FeedCard, DirChip, relTime } from "@/app/_components/ui";
import { addWatch } from "@/app/actions";
import { assetName, domainTerm, getLocale, institutionName, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const locale = await getLocale();
  const institution = await prisma.institution.findUnique({
    where: { slug },
    select: { name: true, country: true },
  });
  if (!institution) return { title: tr(locale, "Institution not found", "机构未找到") };
  const name = institutionName(institution.name, locale);
  return {
    title: name,
    description: tr(
      locale,
      `Published research and extracted views from ${name}${institution.country ? ` (${institution.country})` : ""}.`,
      `${name}${institution.country ? `（${institution.country}）` : ""}的公开研报与提取观点。`,
    ),
  };
}


export default async function InstitutionPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const locale = await getLocale();
  const data = await getInstitutionView(params.slug);
  if (!data) notFound();
  const { inst, articles, count30, views, coverage } = data;

  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Institution", "机构")}</div>
        <h1>{institutionName(inst.name, locale)}</h1>
        <div className="deltas">
          <span className="stars">{"★".repeat(inst.rating)}{"☆".repeat(5 - inst.rating)}</span>
          <span>{tr(locale, "Authority weight", "权威权重")} <b className="mono">{inst.authorityScore.toFixed(2)}</b></span>
          <span>{tr(locale, "Public views · 30d", "公开观点 · 30天")} <b className="mono">{count30}</b></span>
          {coverage.length > 0 && <span style={{ color: "var(--faint)" }}>{coverage.map((item) => domainTerm(item, locale)).join(" · ")}</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href={inst.researchUrl} target="_blank" rel="noopener noreferrer" className="minibtn">{tr(locale, "Research homepage ↗", "研报主页 ↗")}</a>
          <Link href={`/institution/${inst.slug}/accuracy`} className="minibtn">{tr(locale, "Forecast accuracy", "预测准确率")}</Link>
          <form action={addWatch}>
            <input type="hidden" name="kind" value="institution" />
            <input type="hidden" name="refId" value={inst.slug} />
            <input type="hidden" name="back" value={`/institution/${inst.slug}`} />
            <button type="submit" className="minibtn">＋ {tr(locale, "Watch", "关注")}</button>
          </form>
        </div>
      </div>

      {views.length > 0 && (
        <section className="blk">
          <div className="section-t">{tr(locale, "Current Views", "当前观点")}</div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>{tr(locale, "Asset", "资产")}</th><th>{tr(locale, "Direction", "方向")}</th><th>{tr(locale, "Target", "目标价")}</th><th>{tr(locale, "Updated", "更新于")}</th></tr></thead>
              <tbody>
                {views.map((v) => (
                  <tr key={v.ticker}>
                    <td className="inst"><Link href={`/asset/${v.ticker}`}>{assetName(v.name, locale, v.ticker)}</Link></td>
                    <td><DirChip direction={v.direction} locale={locale} /></td>
                    <td className="mono-cell">{v.target ? `$${v.target.toLocaleString()}` : "—"}</td>
                    <td className="mono-cell">{relTime(v.when, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section style={{ paddingTop: 26 }}>
        <div className="section-t">{tr(locale, "Recent Research", "近期研报")}</div>
        <div className="feed">
          {articles.slice(0, 10).map((a) => (
            <FeedCard key={a.id} a={{ ...a, institution: { name: inst.name, slug: inst.slug } }} locale={locale} />
          ))}
          {articles.length === 0 && <p className="mono" style={{ color: "var(--muted)" }}>{tr(locale, "No ingested research yet for this source.", "该来源暂无已入库研报。")}</p>}
        </div>
      </section>
    </main>
  );
}
