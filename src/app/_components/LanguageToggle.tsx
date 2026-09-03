"use client";

import { usePathname } from "next/navigation";

const LOCALE_COOKIE = "tline_locale";
type Locale = "en" | "zh-CN";
const SEGMENT: Record<Locale, string> = { en: "en", "zh-CN": "zh" };

/**
 * Switches language by changing the address, not a cookie.
 *
 * Each language has its own address so that both can be found in search. Setting a
 * cookie and re-rendering would leave the reader on an address that now says something
 * different from what it serves, and would give a search engine nothing to index.
 *
 * The choice is still remembered, but only to decide where an address without a language
 * should send someone.
 */
export default function LanguageToggle({ locale }: { locale: Locale }) {
  const pathname = usePathname();

  function select(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    const rest = pathname.replace(/^\/(?:en|zh)(?=\/|$)/, "");
    // A full load rather than a client-side push: the language of the document is set
    // on <html lang> by the root layout, and a soft navigation swaps the content while
    // leaving that attribute saying the old language — which is what a screen reader and
    // a translation tool actually read.
    window.location.assign(`/${SEGMENT[next]}${rest}`);
  }

  return (
    <div className="language-toggle" role="group" aria-label={trLabel(locale, "Language", "语言")}>
      <button type="button" aria-pressed={locale === "zh-CN"} onClick={() => select("zh-CN")}>{locale === "zh-CN" ? "中文" : "ZH"}</button>
      <button type="button" aria-pressed={locale === "en"} onClick={() => select("en")}>{locale === "zh-CN" ? "英文" : "EN"}</button>
    </div>
  );
}

const trLabel = (locale: Locale, en: string, zh: string) => locale === "zh-CN" ? zh : en;
