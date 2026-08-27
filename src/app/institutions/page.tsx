import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocale, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function InstitutionsPage() {
  const locale = getLocale();
  const insts = await prisma.institution.findMany({
    orderBy: [{ priority: "asc" }, { name: "asc" }],
    include: { _count: { select: { articles: true } } },
  });
  const p1 = insts.filter((i) => i.priority === 1);
  const rest = insts.filter((i) => i.priority !== 1);

  const Row = (i: (typeof insts)[number]) => (
    <Link key={i.id} href={`/institution/${i.slug}`} className="r">
      <span className="inst">{i.name} <span className="stars" style={{ fontSize: 11 }}>{"★".repeat(i.rating)}</span>
        <span className={`chip ${i.crawlPolicy === "allowed" ? "bull" : i.crawlPolicy === "delayed" ? "neu" : i.crawlPolicy === "blocked" ? "bear" : "gray"}`} style={{ marginLeft: 8 }}>
          {tr(locale, i.crawlPolicy, ({ allowed: "允许", delayed: "延迟", blocked: "禁止" } as Record<string, string>)[i.crawlPolicy] ?? "未知")}
        </span>
      </span>
      <span className="source-status">
        {i.lastCrawlStatus && <span
          className={`chip ${i.lastCrawlStatus === "succeeded" ? "bull" : i.lastCrawlStatus === "failed" || i.lastCrawlStatus === "refused" ? "bear" : "neu"}`}
          title={[i.lastCrawlAt?.toISOString(), i.lastCrawlMessage].filter(Boolean).join(" · ")}
        >{tr(locale, i.lastCrawlStatus, ({ succeeded: "成功", failed: "失败", refused: "拒绝", running: "运行中" } as Record<string, string>)[i.lastCrawlStatus] ?? i.lastCrawlStatus)}</span>}
        <span className="n" style={{ color: "var(--muted)" }}>{i._count.articles}</span>
      </span>
    </Link>
  );

  return (
    <main className="wrap">
      <div className="page-head"><div className="eyebrow">{tr(locale, "Sources", "数据源")}</div><h1>{tr(locale, "Institutions", "机构")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, `${insts.length} public research sources · 15 phase-1 priority.`, `${insts.length} 个公开研报来源 · 15 个第一阶段优先来源。`)}</p></div>
      <section className="blk"><div className="section-t">{tr(locale, "Phase-1 Priority (weight-heavy)", "第一阶段优先来源（高权重）")}</div><div className="rowlist">{p1.map(Row)}</div></section>
      <section style={{ paddingTop: 26 }}><div className="section-t">{tr(locale, "All other sources", "其他全部来源")}</div><div className="rowlist">{rest.map(Row)}</div></section>
    </main>
  );
}
