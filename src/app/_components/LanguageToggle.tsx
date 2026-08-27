"use client";

import { useRouter } from "next/navigation";

const LOCALE_COOKIE = "tline_locale";
type Locale = "en" | "zh-CN";

export default function LanguageToggle({ locale }: { locale: Locale }) {
  const router = useRouter();
  function select(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = next;
    router.refresh();
  }
  return (
    <div className="language-toggle" role="group" aria-label={trLabel(locale, "Language", "语言")}>
      <button type="button" aria-pressed={locale === "zh-CN"} onClick={() => select("zh-CN")}>中</button>
      <button type="button" aria-pressed={locale === "en"} onClick={() => select("en")}>EN</button>
    </div>
  );
}

const trLabel = (locale: Locale, en: string, zh: string) => locale === "zh-CN" ? zh : en;
