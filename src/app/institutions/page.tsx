import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function InstitutionsPage() {
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
          {i.crawlPolicy}
        </span>
      </span>
      <span className="n" style={{ color: "var(--muted)" }}>{i._count.articles}</span>
    </Link>
  );

  return (
    <main className="wrap">
      <div className="page-head"><div className="eyebrow">Sources</div><h1>Institutions</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>{insts.length} public research sources · 15 phase-1 priority.</p></div>
      <section className="blk"><div className="section-t">Phase-1 Priority (weight-heavy)</div><div className="rowlist">{p1.map(Row)}</div></section>
      <section style={{ paddingTop: 26 }}><div className="section-t">All other sources</div><div className="rowlist">{rest.map(Row)}</div></section>
    </main>
  );
}
