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

const ZH_LABELS: Record<string, string> = {
  member: "普通用户", reviewer: "审核员", admin: "管理员",
  free: "免费版", professional: "专业版", enterprise: "企业版", founding: "创始会员",
  running: "运行中", queued: "已排队", succeeded: "成功", failed: "失败", stopped: "已停止", stale: "心跳异常",
  ok: "正常", active: "启用", paused: "已暂停", new: "未运行", circuit_open: "熔断中",
  allowed: "允许抓取", delayed: "延迟抓取", blocked: "禁止抓取", refused: "已拒绝",
  reviewed: "已审核", needs_review: "需要审核", invited: "待设密码", suspended: "已封禁",
  PENDING_REVIEW: "待审核", APPROVED: "已批准", PUBLISHING: "发布中", PARTIAL: "部分成功",
  SUCCEEDED: "全部成功", FAILED: "失败", REJECTED: "已拒绝", PENDING: "待发布", RETRY: "等待重试",
  macro: "宏观数据", research: "研报", social: "内容发布", ingest: "研报采集",
  en: "英文", "zh-CN": "中文",
};

/** Chinese names for internal enum values shown in the console. */
export function adminLabel(value: string): string {
  return ZH_LABELS[value] ?? value;
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
