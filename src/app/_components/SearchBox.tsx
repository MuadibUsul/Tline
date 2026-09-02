"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

interface Result {
  id: string;
  kind: "institution" | "asset" | "article" | "view";
  title: string;
  subtitle: string;
  snippet?: string;
  snippetMatch?: string;
  matchKind?: "content";
  href: string;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return text;
  const pieces = text.split(new RegExp(`(${escaped})`, "ig"));
  return <>{pieces.map((piece, index) => piece.toLocaleLowerCase() === query.trim().toLocaleLowerCase()
    ? <mark key={index}>{piece}</mark>
    : <Fragment key={index}>{piece}</Fragment>)}</>;
}

export default function SearchBox({ placeholder, ariaLabel, locale }: { placeholder: string; ariaLabel: string; locale: "en" | "zh-CN" }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&locale=${encodeURIComponent(locale)}`, { signal: controller.signal });
        const data = response.ok ? await response.json() as { results?: Result[] } : {};
        setResults(data.results ?? []);
        setActive(0);
        setOpen(true);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 100);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, locale]);

  const choose = (result?: Result) => {
    if (result) router.push(result.href);
  };
  const labels = locale === "zh-CN"
    ? { institution: "机构", asset: "资产", article: "研报", view: "观点", content: "正文命中", empty: "没有找到相关内容", hint: "输入至少两个字符", loading: "搜索中…" }
    : { institution: "Institution", asset: "Asset", article: "Research", view: "View", content: "Content match", empty: "No matching content", hint: "Type at least two characters", loading: "Searching…" };

  return (
    <div className="site-search" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <form className="searchbar" role="search" onSubmit={(event) => { event.preventDefault(); choose(results[active] ?? results[0]); }}>
        <span aria-hidden="true">⌕</span>
        <input
          value={q}
          onChange={(event) => { setQ(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, results.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
            if (event.key === "Enter" && results[active]) { event.preventDefault(); choose(results[active]); }
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={open && q.trim().length >= 2}
          aria-controls="site-search-results"
          aria-activedescendant={results[active] ? `search-result-${results[active].id}` : undefined}
          autoComplete="off"
        />
        {q && <button className="search-clear" type="button" onClick={() => { setQ(""); setResults([]); }} aria-label={locale === "zh-CN" ? "清除搜索" : "Clear search"}>×</button>}
      </form>

      {open && q.trim().length >= 2 && (
        <div id="site-search-results" className="search-results" role="listbox" aria-label={locale === "zh-CN" ? "搜索结果" : "Search results"}>
          {loading && results.length === 0 && <div className="search-state">{labels.loading}</div>}
          {!loading && results.length === 0 && <div className="search-state">{labels.empty}</div>}
          {results.map((result, index) => (
            <Link
              id={`search-result-${result.id}`}
              key={`${result.kind}-${result.id}`}
              href={result.href}
              role="option"
              aria-selected={index === active}
              className={`search-result${index === active ? " active" : ""}`}
              onMouseEnter={() => setActive(index)}
            >
              <span className="search-kind">{labels[result.kind]}</span>
              <span className="search-copy">
                <strong><Highlight text={result.title} query={q} /></strong>
                <small>{result.subtitle}{result.matchKind === "content" && <em>{labels.content}</em>}</small>
                {result.snippet && <span><Highlight text={result.snippet} query={result.snippetMatch || q} /></span>}
              </span>
              <span className="search-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}
      <span className="sr-only" aria-live="polite">{loading ? labels.loading : q.trim().length < 2 ? labels.hint : `${results.length}`}</span>
    </div>
  );
}
