"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { track } from "./Analytics";
import { trapFocus } from "./focusTrap";

export type GateReason = "bookmark" | "watch" | "dashboard";
type Locale = "en" | "zh-CN";

const COPY = {
  bookmark: {
    en: {
      kicker: "Free account",
      title: "Save this research",
      body: "Create a free account to keep this report, follow the institution, and return to it later.",
      primary: "Create a free account or sign in",
      secondary: "Keep reading",
      note: "You can read this report in full without an account.",
    },
    "zh-CN": {
      kicker: "免费账户",
      title: "把这份研究保存下来",
      body: "免费创建账户，保存关注的研报，追踪机构后续观点。",
      primary: "免费注册 / 登录",
      secondary: "继续阅读",
      note: "不用注册也可以完整阅读本篇研报。",
    },
  },
  watch: {
    en: {
      kicker: "Free account",
      title: "Follow what changes",
      body: "Create a free account to follow this subject and keep its later views in one place.",
      primary: "Create a free account or sign in",
      secondary: "Not now",
      note: "Public research remains fully readable without an account.",
    },
    "zh-CN": {
      kicker: "免费账户",
      title: "关注它，持续看后续观点",
      body: "免费创建账户，把这项资产或机构的后续观点集中在一处。",
      primary: "免费注册 / 登录",
      secondary: "暂不关注",
      note: "公开研报仍可完整阅读。",
    },
  },
  dashboard: {
    en: {
      kicker: "Free account",
      title: "Create your research workspace",
      body: "A free account saves dashboards to your own workspace, with your watchlist and alerts beside them.",
      primary: "Create a free account or sign in",
      secondary: "Keep browsing",
      note: "The public dashboard catalogue stays available without an account.",
    },
    "zh-CN": {
      kicker: "免费账户",
      title: "创建你的研究工作台",
      body: "免费创建账户，把看板保存到自己的工作台，并把关注列表和提醒放在一起。",
      primary: "免费注册 / 登录",
      secondary: "继续浏览",
      note: "公开看板目录无需注册即可浏览。",
    },
  },
} as const;

export default function RegistrationGate({
  open,
  onClose,
  locale,
  reason,
  next,
}: {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  reason: GateReason;
  next: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const copy = COPY[reason][locale];
  const signInHref = `/signin?next=${encodeURIComponent(next)}`;

  const close = useCallback(() => {
    track("gate_dismiss", undefined, { gate_reason: reason, locale });
    onClose();
  }, [locale, onClose, reason]);

  useEffect(() => {
    if (!open) return;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(event, panelRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 20);
    track("gate_view", undefined, { gate_reason: reason, locale });
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restore?.focus();
    };
  }, [close, locale, open, reason]);

  if (!open) return null;

  return (
    <div
      className="reg-gate-overlay"
      role="presentation"
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div
        className="reg-gate-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button ref={closeRef} type="button" className="reg-gate-close" onClick={close} aria-label={locale === "zh-CN" ? "关闭" : "Close"}>
          <span aria-hidden="true">×</span>
        </button>
        <p className="reg-gate-kicker">{copy.kicker}</p>
        <h2 id={titleId}>{copy.title}</h2>
        <p className="reg-gate-copy">{copy.body}</p>
        <a
          className="minibtn p reg-gate-primary"
          href={signInHref}
          onClick={() => track("gate_cta_click", undefined, { gate_reason: reason, locale })}
        >
          {copy.primary} →
        </a>
        <button type="button" className="minibtn reg-gate-secondary" onClick={close}>
          {copy.secondary}
        </button>
        <p className="reg-gate-note">{copy.note}</p>
      </div>
    </div>
  );
}

/** A small hook so callers do not each re-implement the open/close pair. */
export function useRegistrationGate() {
  const [open, setOpen] = useState(false);
  return { open, openGate: () => setOpen(true), closeGate: () => setOpen(false) };
}
