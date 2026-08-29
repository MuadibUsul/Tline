import Link from "next/link";
import { prisma } from "@/lib/db";
import { computeConsensus } from "@/lib/consensus";
import { assetName, formatDate, getLocale, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const CLASSES = ["equity", "rate", "fx", "commodity", "crypto", "macro"] as const;
export default async function MarketsPage() {
  const locale = getLocale();
  const labels: Record<string, string> = { equity: tr(locale, "Equities", "股票"), rate: tr(locale, "Rates", "利率"), fx: tr(locale, "FX", "外汇"), commodity: tr(locale, "Commodities", "大宗商品"), crypto: tr(locale, "Crypto", "加密资产"), macro: tr(locale, "Macro", "宏观") };
  const assets = await prisma.asset.findMany({ orderBy: { name: "asc" } });
  const scored = await Promise.all(assets.map(async (a) => ({ a, c: await computeConsensus(a.id) })));

  return (
    <main className="wrap">
      <div className="page-head"><div className="eyebrow">{tr(locale, "Markets", "市场")}</div><h1>{tr(locale, "Markets", "市场")}</h1><p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, "Consensus uses the rolling last 24 hours, or the latest available 24-hour window when no current research exists.", "市场共识优先使用滚动最近24小时；若无新研报，则沿用最近可用的24小时窗口。")}</p></div>
      <div className="markets-grid">
        {CLASSES.map((cls) => {
          const group = scored.filter((x) => x.a.assetClass === cls);
          if (group.length === 0) return null;
          return (
            <section key={cls} className="blk">
              <div className="section-t">{labels[cls]}</div>
              <div className="rowlist">
                {group.map(({ a, c }) => (
                  <Link key={a.ticker} href={`/asset/${a.ticker}`} className="r">
                    <span className="inst">{assetName(a.name, locale, a.ticker)} <span className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>{a.ticker}</span></span>
                    {c ? <span className={`n ${c.tone === "bull" ? "up" : c.tone === "bear" ? "down" : "flat"}`}>{c.score} · {c.tone === "bull" ? tr(locale, c.label, "看多") : c.tone === "bear" ? tr(locale, c.label, "看空") : tr(locale, c.label, "中性")}{c.isFallback ? ` · ${tr(locale, "as of", "截至")} ${formatDate(c.windowEnd, locale)}` : ""}</span>
                       : <span className="mono" style={{ color: "var(--faint)" }}>{tr(locale, "no data", "暂无数据")}</span>}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
