"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { track } from "./Analytics";

const VIEWS_KEY = "tline_research_views";
const SEEN_KEY = "tline_reg_nudge_seen";

/**
 * A single, dismissible, in-flow account prompt. It is not a modal: the article and its
 * links remain in the document, and nothing is shown until the reader has seen two reports
 * in this session and scrolled most of the current one.
 */
export default function InlineRegistrationCTA({ locale, enabled, rollout }: { locale: Locale; enabled: boolean; rollout: number }) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const zh = locale === "zh-CN";

  useEffect(() => {
    if (!enabled || !pathname) return;
    let timer: number | undefined;
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
      const bucketKey = "tline_reg_bucket";
      const storedBucket = sessionStorage.getItem(bucketKey);
      const bucket = storedBucket === null ? Math.floor(Math.random() * 100) : Number(storedBucket);
      if (storedBucket === null) sessionStorage.setItem(bucketKey, String(bucket));
      if (!Number.isFinite(bucket) || bucket >= rollout) return;
      const stored = sessionStorage.getItem(VIEWS_KEY);
      const views = stored ? JSON.parse(stored) as string[] : [];
      if (!views.includes(pathname)) {
        views.push(pathname);
        sessionStorage.setItem(VIEWS_KEY, JSON.stringify(views.slice(-20)));
      }
      if (views.length < 2) return;
      const onScroll = () => {
        const root = document.documentElement;
        const scrollable = root.scrollHeight - window.innerHeight;
        if (scrollable <= 0 || window.scrollY / scrollable < 0.6) return;
        window.removeEventListener("scroll", onScroll);
        sessionStorage.setItem(SEEN_KEY, "1");
        track("gate_eligible", undefined, { gate_reason: "inline", locale });
        setVisible(true);
        track("gate_view", undefined, { gate_reason: "inline", locale });
      };
      timer = window.setTimeout(onScroll, 0);
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        if (timer) window.clearTimeout(timer);
        window.removeEventListener("scroll", onScroll);
      };
    } catch {
      // Storage can be unavailable; the reader simply keeps the uninterrupted page.
    }
  }, [enabled, locale, pathname, rollout]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch {}
    track("gate_dismiss", undefined, { gate_reason: "inline", locale });
  };

  return (
    <aside className="inline-reg-gate" aria-label={zh ? "注册提示" : "Account prompt"}>
      <div>
        <b>{zh ? "开始建立你的机构观察清单" : "Start your institutional watchlist"}</b>
        <p>{zh ? "收藏研报、关注黄金/美债等资产，集中查看观点变化。公开研报无需账户即可完整阅读。" : "Save reports and follow assets such as gold or Treasuries in one place. Public research stays fully readable without an account."}</p>
      </div>
      <div className="inline-reg-gate-actions">
        <Link
          className="minibtn p"
          href={`/signin?next=${encodeURIComponent(pathname ?? "/")}`}
          onClick={() => track("gate_cta_click", undefined, { gate_reason: "inline", locale })}
        >
          {zh ? "免费创建账户" : "Create a free account"}
        </Link>
        <button type="button" className="minibtn" onClick={dismiss}>{zh ? "暂时不用" : "Not now"}</button>
      </div>
    </aside>
  );
}
