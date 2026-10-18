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
      <b>{zh ? "我们重视您的隐私" : "We value your privacy"}</b>
      <p>
        {zh
          ? "我们使用 Cookie 改善浏览体验并统计访问情况。"
          : "We use cookies to improve your browsing experience and measure traffic."}
      </p>
      <Link href={`/${locale === "zh-CN" ? "zh" : "en"}/privacy`}>{zh ? "Cookie 政策" : "Cookie Policy"}</Link>
      <div className="cookie-consent-actions">
        <button type="button" className="minibtn" onClick={() => choose("denied")}>
          {zh ? "仅必要" : "Essential only"}
        </button>
        <button type="button" className="minibtn p" onClick={() => choose("granted")}>
          {zh ? "接受" : "Accept"}
        </button>
      </div>
    </section>
  );
}
