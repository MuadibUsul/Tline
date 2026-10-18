import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { listPublicInstitutions } from "@/lib/institutionDirectory";
import { getLocale, institutionName, localePath, tr, type Locale } from "@/lib/i18n";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, collectionPageJsonLd, localizedUrl, ogImage } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The institution directory (PRD P05): publishing houses, not the views stream that lives
 * at /institutions. Deliberately a new address — the old one keeps its meaning and its
 * history, and nothing about this page changes what /institutions serves.
 *
 * Only houses with at least one report the gate admits are listed, and the count shown is
 * that same public subset — a directory that counts drafts would advertise numbers no page
 * can show.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const count = await prisma.institution.count({ where: { articles: { some: publicationReadyWhere() } } });
  const title = tr(locale, "Institutions", "机构目录");
  const description = clamp(tr(
    locale,
    `The ${count} institutions whose public research Tlines carries: what each publishes, how much of it passed the publication gate, and every report on Tlines attributed to them.`,
    `Tlines 收录的 ${count} 家机构：它们各自发布什么、有多少篇通过公开闸门，以及 Tlines 上归属于它们的全部研报。`,
  ), 158);
  return {
    ...canonical("/institutions-directory", locale),
    title: { absolute: `${title} · Tlines` },
    description,
    openGraph: { type: "website", title, description, url: localizedUrl("/institutions-directory", locale), locale, images: [{ url: ogImage("Institutions", title, tr(locale, "Every publisher, every sourced report", "每一家机构，每一篇可溯源研报")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function InstitutionsDirectory() {
  const locale: Locale = await getLocale();
  const institutions = await listPublicInstitutions();
  const total = institutions.reduce((sum, institution) => sum + institution._count.articles, 0);

  return (
    <main className="wrap">
      <JsonLd data={collectionPageJsonLd(locale, "/institutions-directory", tr(locale, "Institutions", "机构目录"), tr(locale, "The publishing institutions whose research Tlines carries.", "Tlines 收录其公开研报的发布机构。"), tr(locale, "Publishing institutions", "发布机构"))} />
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "Institutions", "机构目录"), path: "/institutions-directory" }])} />
      <nav aria-label={tr(locale, "Breadcrumb", "面包屑")} className="mono" style={{ fontSize: 11, color: "var(--faint)", margin: "16px 0 12px" }}>
        <Link href={localePath(locale, "/")}>{tr(locale, "Home", "首页")}</Link>
      </nav>
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Directory", "目录")}</div>
        <h1>{tr(locale, "Institutions", "机构目录")}</h1>
        <p className="sub measure">
          {tr(locale,
            `${institutions.length} publishing houses and ${total.toLocaleString(locale)} reports that passed the publication gate. Each profile carries the house's own reports; an institution's view is its own, and Tlines reporting it is not Tlines agreeing with it.`,
            `${institutions.length} 家发布机构，共 ${total.toLocaleString(locale)} 篇通过公开闸门的研报。每个档案页只收录该机构自己的研报；机构观点不代表 Tlines 立场。`)}
        </p>
      </div>
      <section className="blk">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 10 }}>
          {institutions.map((institution) => (
            <Link
              key={institution.slug}
              href={localePath(locale, `/institution/${institution.slug}`)}
              className="blk"
              style={{ margin: 0, padding: "12px 14px", display: "block" }}
            >
              <b style={{ fontSize: 14 }}>{institutionName(institution.name, locale)}</b>
              <span className="mono" style={{ display: "block", fontSize: 11, color: "var(--faint)", marginTop: 4 }}>
                {institution.country ?? tr(locale, "International", "国际")} · {institution._count.articles.toLocaleString(locale)} {tr(locale, "reports", "篇研报")}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
