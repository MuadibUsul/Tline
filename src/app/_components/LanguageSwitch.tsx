"use client";

import { usePathname } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import { languageSwitchTarget } from "@/lib/languageSwitch";

/**
 * A plain anchor, not a router link: switching language must replace the document so the
 * whole layout (including <html lang>) is rendered in the target language. `usePathname`
 * keeps the href current after client-side navigation.
 */
export default function LanguageSwitch({
  locale,
  label,
  ariaLabel,
}: {
  locale: Locale;
  label: string;
  ariaLabel: string;
}) {
  const pathname = usePathname();
  const target = languageSwitchTarget(pathname, locale);
  if (!target) return null;
  return (
    <a className="minibtn" href={target.href} hrefLang={target.hrefLang} aria-label={ariaLabel}>
      {label}
    </a>
  );
}
