"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * The ⌘K / Ctrl+K search overlay (PRD P07).
 *
 * Searches through the existing /api/search endpoint — the versioned in-memory index is
 * the site's search, and this is only a faster way into it. Results are keyboard
 * navigable (↑ ↓ Enter, Esc closes); the footer link hands the query to /search, which
 * renders the same results server-side for readers without JS.
 */

interface Hit {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  snippet?: string;
  href: string;
}

const KIND_LABEL: Record<string, { en: string; zh: string }> = {
  institution: { en: "Institution", zh: "机构" },
  asset: { en: "Asset", zh: "资产" },
  article: { en: "Report", zh: "研报" },
  view: { en: "View", zh: "观点" },
};

export default function SearchOverlay({
  locale,
  labels,
}: {
  locale: string;
  labels: { placeholder: string; trigger: string; aria: string; all: string; none: string; hint: string };
}) {
  const zh = locale === "zh-CN";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(timer);
    }
    setQuery("");
    setHits([]);
    setCursor(0);
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&locale=${encodeURIComponent(locale)}`, { signal: controller.signal });
        const data = response.ok ? (await response.json() as { results?: Hit[] }) : {};
        setHits((data.results ?? []).slice(0, 8));
        setCursor(0);
      } catch {
        /* aborted or offline: keep the previous list */
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, locale]);

  const navigate = (hit: Hit) => window.location.assign(hit.href);

  return (
    <>
      <button type="button" className="search-trigger" onClick={() => setOpen(true)} aria-label={labels.aria}>
        <Icon name="search" />
        {labels.trigger}
        <kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="search-overlay" role="dialog" aria-modal="true" aria-label={labels.aria} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="panel">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") { event.preventDefault(); setCursor((value) => Math.min(value + 1, hits.length - 1)); }
                else if (event.key === "ArrowUp") { event.preventDefault(); setCursor((value) => Math.max(value - 1, 0)); }
                else if (event.key === "Enter" && hits[cursor]) { event.preventDefault(); navigate(hits[cursor]); }
              }}
              placeholder={labels.placeholder}
              aria-label={labels.placeholder}
            />
            <div className="results">
              {hits.map((hit, index) => (
                <a
                  key={hit.id}
                  href={hit.href}
                  className={index === cursor ? "on" : undefined}
                  onMouseEnter={() => setCursor(index)}
                >
                  <span className="k">{zh ? KIND_LABEL[hit.kind]?.zh ?? hit.kind : KIND_LABEL[hit.kind]?.en ?? hit.kind}</span>
                  <span className="t">
                    {hit.title}
                    {hit.subtitle ? <small>{hit.subtitle}</small> : null}
                  </span>
                </a>
              ))}
              {query.trim().length >= 2 && hits.length === 0 && <div className="empty-state">{labels.none}</div>}
              {query.trim().length >= 2 && (
                <a href={`${zh ? "/zh" : "/en"}/search?q=${encodeURIComponent(query.trim())}`} className={hits.length === cursor ? "on" : undefined} onMouseEnter={() => setCursor(hits.length)}>
                  <span className="k"><Icon name="external" /></span>
                  <span className="t">{labels.all}</span>
                </a>
              )}
            </div>
            <div style={{ padding: "8px 18px", font: "10.5px var(--mono)", color: "var(--faint)", borderTop: "1px solid var(--border)" }}>{labels.hint}</div>
          </div>
        </div>
      )}
    </>
  );
}
