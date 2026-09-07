import type { Locale } from "@/lib/i18n";

/** Metrics and parameters are stored as JSON text; a malformed row must not break a page. */
export function json(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** "3分钟前" / "3m ago". Coarse on purpose: the console reads these at a glance. */
export function age(value: Date | null | undefined, locale: Locale): string {
  if (!value) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - value.getTime()) / 60_000));
  if (minutes < 60) return locale === "zh-CN" ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return locale === "zh-CN" ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return locale === "zh-CN" ? `${days} 天前` : `${days}d ago`;
}

/** Absolute timestamp, always UTC, so two operators reading it agree on what it says. */
export function when(value: Date | null | undefined, locale: Locale): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value);
}

/** Chip colour for a status word, shared by every table that shows one. */
export function tone(status: string | null | undefined): string {
  if (status === "succeeded" || status === "reviewed" || status === "ok" || status === "active") return "bull";
  if (status === "failed" || status === "needs_review" || status === "refused" || status === "suspended") return "bear";
  if (status === "running" || status === "queued") return "acc";
  return "gray";
}

/** Compact counts: 1234 → 1.2k. Long numbers wreck a fixed-width stat card. */
export function compact(value: number): string {
  if (Math.abs(value) < 1000) return String(value);
  if (Math.abs(value) < 1_000_000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** Percentage change against a previous period, or null when there is nothing to compare. */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** English pluralisation for the counts these dashboards print. Chinese needs none. */
export function plural(count: number, singular: string, plural_: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural_}`;
}
