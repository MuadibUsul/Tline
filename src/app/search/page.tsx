import type { Metadata } from "next";
import Link from "next/link";
import { searchSite } from "@/lib/search";
import { getLocale, localePath, tr, type Locale } from "@/lib/i18n";
import { noIndex } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * Full search results (PRD P07). Search pages are not indexed — the queries are unbounded
 * and a crawl of them produces nothing a reader searched for — while the results
 * themselves link to pages that are.
 */

export const metadata: Metadata = { title: "Search", ...noIndex };

const KIND_LABEL: Record<string, { en: string; zh: string }> = {
  institution: { en: "Institution", zh: "机构" },
  asset: { en: "Asset", zh: "资产" },
  article: { en: "Report", zh: "研报" },
  view: { en: "View", zh: "观点" },
};

export default async function SearchPage(props: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await props.searchParams;
  const locale: Locale = await getLocale();
  const query = (q ?? "").trim().slice(0, 200);
  const results = query.length >= 2 ? await searchSite(query, 30, locale) : [];

  return (
    <main className="wrap" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Search", "搜索")}</div>
        <h1>{query ? tr(locale, `Results for “${query}”`, `“${query}” 的搜索结果`) : tr(locale, "Search", "搜索")}</h1>
      </div>
      <form method="get" action={localePath(locale, "/search")} style={{ display: "flex", gap: 8, margin: "0 0 18px" }}>
        <input
          name="q"
          defaultValue={query}
          placeholder={tr(locale, "Search an institution, asset, topic or view…", "搜索机构、资产、主题或观点……")}
          aria-label={tr(locale, "Search the site", "全站搜索")}
          style={{ flex: 1, font: "13px var(--mono)", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel)", color: "var(--ink)" }}
        />
        <button className="minibtn p" type="submit">{tr(locale, "Search", "搜索")}</button>
      </form>
      {query.length >= 2 && results.length === 0 && (
        <div className="empty-state">{tr(locale, "Nothing matched. Try the institution's name, a ticker, or a broader topic.", "没有匹配结果。试试机构名、品种代码或更宽泛的主题。")}</div>
      )}
      {results.length > 0 && (
        <section className="rowlist">
          {results.map((result) => (
            <Link key={`${result.kind}-${result.id}`} href={result.href} className="r" style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px dashed var(--border)" }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent-ink)", paddingTop: 3, minWidth: 56 }}>
                {locale === "zh-CN" ? KIND_LABEL[result.kind]?.zh ?? result.kind : KIND_LABEL[result.kind]?.en ?? result.kind}
              </span>
              <span>
                <b style={{ fontSize: 14 }}>{result.title}</b>
                {result.subtitle ? <small className="mono" style={{ display: "block", fontSize: 11, color: "var(--faint)", marginTop: 3 }}>{result.subtitle}</small> : null}
              </span>
            </Link>
          ))}
        </section>
      )}
      <p className="sub" style={{ marginTop: 20 }}>
        <Link href={localePath(locale, "/research")}>{tr(locale, "Or browse the research feed", "或浏览研报流")} →</Link>
      </p>
    </main>
  );
}
