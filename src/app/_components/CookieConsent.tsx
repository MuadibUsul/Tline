"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { chooseConsent, consentDecision } from "@/lib/analytics/clientIdentity";

/**
 * The first-party analytics notice.
 *
 * The site keeps its cookieless aggregate when a reader declines; accepting adds one
 * random visitor id so returning anonymous readers can be counted across days. The banner
 * is deliberately a small, non-blocking bar: content is never hidden behind it.
 */
export default function CookieConsent({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(consentDecision() === "unknown");
  }, []);

  if (!open) return null;
  const zh = locale === "zh-CN";
  const choose = (decision: "granted" | "denied") => {
    chooseConsent(decision);
    setOpen(false);
  };

  return (
    <section className="cookie-consent" aria-label={zh ? "Cookie 同意" : "Cookie consent"}>
      <div className="cookie-consent-copy">
        <b>{zh ? "关于分析 Cookie" : "About analytics cookies"}</b>
        <p>
          {zh
            ? "我们使用第一方分析了解内容表现。接受会设置一个匿名访客 Cookie（180 天），用于跨天统计回访；拒绝则只保留不识别个人的汇总统计。"
            : "We use first-party analytics to understand what is being read. Accepting sets a random visitor cookie for 180 days so returning readers can be counted; declining keeps only non-identifying aggregate counts."}
        </p>
        <Link href={`/${locale === "zh-CN" ? "zh" : "en"}/privacy`}>{zh ? "隐私说明" : "Privacy"}</Link>
      </div>
      <div className="cookie-consent-actions">
        <button type="button" className="minibtn" onClick={() => choose("denied")}>
          {zh ? "仅必要" : "Essential only"}
        </button>
        <button type="button" className="minibtn p" onClick={() => choose("granted")}>
          {zh ? "允许分析" : "Allow analytics"}
        </button>
      </div>
    </section>
  );
}
