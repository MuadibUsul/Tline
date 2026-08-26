import Link from "next/link";
import { prisma } from "@/lib/db";
import { computeConsensus } from "@/lib/consensus";

export const dynamic = "force-dynamic";

const CLASSES = ["equity", "rate", "fx", "commodity", "crypto", "macro"] as const;
const LABEL: Record<string, string> = { equity: "Equities", rate: "Rates", fx: "FX", commodity: "Commodities", crypto: "Crypto", macro: "Macro" };

export default async function MarketsPage() {
  const assets = await prisma.asset.findMany({ orderBy: { name: "asc" } });
  const scored = await Promise.all(assets.map(async (a) => ({ a, c: await computeConsensus(a.id) })));

  return (
    <main className="wrap">
      <div className="page-head"><div className="eyebrow">Markets</div><h1>Markets</h1></div>
      {CLASSES.map((cls) => {
        const group = scored.filter((x) => x.a.assetClass === cls);
        if (group.length === 0) return null;
        return (
          <section key={cls} className="blk">
            <div className="section-t">{LABEL[cls]}</div>
            <div className="rowlist">
              {group.map(({ a, c }) => (
                <Link key={a.ticker} href={`/asset/${a.ticker}`} className="r">
                  <span className="inst">{a.name} <span className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>{a.ticker}</span></span>
                  {c ? <span className={`n ${c.tone === "bull" ? "up" : c.tone === "bear" ? "down" : "flat"}`}>{c.score} · {c.label}</span>
                     : <span className="mono" style={{ color: "var(--faint)" }}>no data</span>}
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
