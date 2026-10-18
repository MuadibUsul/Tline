"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { automationSignals, ensureVisitorKey } from "@/lib/analytics/clientIdentity";

/**
 * The audience beacon.
 *
 * A first-party, no-third-party tracker. The reader's address and raw UA never leave the
 * server; the browser sends only what the server cannot know — page, referrer, campaign,
 * visible/active time, scroll stops, section attention, clicks, and the automation flags
 * that separate a real browser from a headless one.
 *
 * The stable visitor id is opt-in. Until the reader accepts the analytics cookie, the
 * server falls back to the daily rotating digest; after acceptance, `ensureVisitorKey`
 * creates the cookie and the same ID follows them across days.
 */

const ENDPOINT = "/api/analytics";
const SESSION_KEY = "tline_analytics_session";
const LAST_VIEW_KEY = "tline_analytics_last_view";
const IDLE_MS = 30 * 60_000;
const ACTIVE_STEP_MS = 30_000;
const INTERNAL_PATH = /^\/admin(?:\/|$)/;

type Payload = Record<string, unknown>;
let activeViewId: string | null = null;

function newId(): string {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi?.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function send(payload: Payload) {
  if (typeof window === "undefined") return;
  try {
    // If the reader accepted between page loads, this creates the stable id before the
    // beacon is sent. Declining removes it in the consent component.
    ensureVisitorKey();
    const body = JSON.stringify({
      ...payload,
      viewId: payload.viewId ?? activeViewId ?? undefined,
      session: session().id,
      signals: automationSignals(),
    });
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
    void fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {});
  } catch {
    // Analytics never breaks a page: a blocked storage API or a refused request is fine.
  }
}

/**
 * The current visit, and whether this call is the one that began it.
 *
 * `fresh` is what marks a landing page, and it has to mean "a new session started here",
 * not "this tab has no key yet": a reader who comes back after an idle gap gets a new
 * session id, and their first page is an entry again.
 */
function session(): { id: string; fresh: boolean } {
  try {
    const now = Date.now();
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const [id, seen] = raw.split(":");
      if (id && now - Number(seen) < IDLE_MS) {
        sessionStorage.setItem(SESSION_KEY, `${id}:${now}`);
        return { id, fresh: false };
      }
    }
    const id = newId();
    sessionStorage.setItem(SESSION_KEY, `${id}:${now}`);
    return { id, fresh: true };
  } catch {
    // Private mode, or storage disabled: the visit still counts, it just does not join up.
    return { id: "nostore", fresh: true };
  }
}

function campaign(): Payload | undefined {
  const params = new URLSearchParams(window.location.search);
  const utm = {
    source: params.get("utm_source") ?? undefined,
    medium: params.get("utm_medium") ?? undefined,
    campaign: params.get("utm_campaign") ?? undefined,
  };
  return utm.source || utm.medium || utm.campaign ? { utm } : undefined;
}

function scrollPct(): number {
  const root = document.documentElement;
  const height = Math.max(root.scrollHeight, window.innerHeight);
  return Math.max(0, Math.min(100, Math.round(((window.scrollY + window.innerHeight) / height) * 100)));
}

function cleanLabel(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 120) : null;
}

function headingAtViewport(): string | null {
  const headings = Array.from(document.querySelectorAll<HTMLElement>("main h1, main h2, main h3"));
  let last: string | null = null;
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top <= window.innerHeight * 0.4) {
      last = cleanLabel(heading.innerText);
    }
  }
  return last;
}

function sectionFrom(element: Element | null): string | null {
  const section = element?.closest<HTMLElement>("[data-track-section]");
  return section?.dataset.trackSection ?? headingAtViewport();
}

/**
 * Reports a named action. Safe to call from anywhere in the browser, including before
 * this component has mounted — it is a plain function, not a hook.
 */
export function track(name: string, value?: number, metadata?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  send({ type: "event", name, value, metadata, path: window.location.pathname });
}

export default function Analytics() {
  const pathname = usePathname();
  // The path this timer belongs to, so a route change reports against the page that was
  // actually being read rather than the one just navigated to.
  const open = useRef<{ path: string; since: number } | null>(null);

  useEffect(() => {
    if (!pathname || INTERNAL_PATH.test(pathname)) return;
    const viewId = newId();
    activeViewId = viewId;
    const entry = session().fresh;
    const startedAt = Date.now();

    try {
      const previous = sessionStorage.getItem(LAST_VIEW_KEY);
      if (previous && previous !== viewId) send({ type: "transition", fromViewId: previous, toPath: pathname });
      sessionStorage.setItem(LAST_VIEW_KEY, viewId);
    } catch {
      // No tab storage: navigation still works, the flow simply has no previous view.
    }

    send({ type: "pageview", path: pathname, viewId, referrer: document.referrer || undefined, entry, ...campaign() });
    open.current = { path: pathname, since: startedAt };

    let visibleMs = 0;
    let activeMs = 0;
    let visibleSince: number | null = document.visibilityState === "visible" ? startedAt : null;
    let lastActivity = startedAt;
    let maxScroll = scrollPct();
    let lastScrollPct = maxScroll;
    let lastScrollAt = startedAt;
    let clickCount = 0;
    let finished = false;
    const stops: Array<{ pct: number; ms: number }> = [];

    const sectionState = new Map<string, { title: string; visibleMs: number; maxVisiblePct: number; since: number | null }>();
    const sectionElements = Array.from(document.querySelectorAll<HTMLElement>("[data-track-section]"));
    for (const element of sectionElements) {
      const id = element.dataset.trackSection;
      if (!id || sectionState.has(id)) continue;
      sectionState.set(id, {
        title: cleanLabel(element.dataset.trackTitle) ?? cleanLabel(element.querySelector("h1,h2,h3")?.textContent) ?? id,
        visibleMs: 0,
        maxVisiblePct: 0,
        since: null,
      });
    }

    const addVisibleTime = () => {
      if (visibleSince === null) return;
      visibleMs += Date.now() - visibleSince;
      visibleSince = null;
    };
    const startVisibleTime = () => {
      if (visibleSince === null && document.visibilityState === "visible") visibleSince = Date.now();
    };
    const activity = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      activeMs += Math.min(now - lastActivity, ACTIVE_STEP_MS);
      lastActivity = now;
    };
    const addSectionTime = () => {
      const now = Date.now();
      for (const state of sectionState.values()) {
        if (state.since !== null) {
          state.visibleMs += now - state.since;
          state.since = null;
        }
      }
    };

    const onScroll = () => {
      const pct = scrollPct();
      maxScroll = Math.max(maxScroll, pct);
      const now = Date.now();
      if (pct !== lastScrollPct) {
        if (now - lastScrollAt > 1200) stops.push({ pct: lastScrollPct, ms: now - lastScrollAt });
        lastScrollAt = now;
        lastScrollPct = pct;
      }
      activity();
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>("a,button,[role=button],[data-track]")
        : null;
      if (!target || target.closest(".cookie-consent")) return;
      const anchor = target instanceof HTMLAnchorElement ? target : target.querySelector<HTMLAnchorElement>("a");
      const href = target.dataset.href ?? anchor?.href ?? null;
      const label = cleanLabel(target.dataset.trackLabel ?? target.getAttribute("aria-label") ?? target.innerText ?? target.querySelector("img")?.alt);
      const type = target.dataset.trackType
        ?? (anchor ? (anchor.host && anchor.host !== window.location.host ? "outbound" : "nav") : "action");
      clickCount++;
      activity();
      send({
        type: "click",
        path: pathname,
        viewId,
        clicks: {
          targetPath: href,
          targetLabel: label,
          targetType: type,
          section: target.dataset.trackSection ?? target.closest<HTMLElement>("[data-track-section]")?.dataset.trackSection ?? sectionFrom(target),
          xPct: Math.round(((event.clientX + window.scrollX) / Math.max(1, document.documentElement.scrollWidth)) * 100),
          yPct: Math.round(((event.clientY + window.scrollY) / Math.max(1, document.documentElement.scrollHeight)) * 100),
          scrollPct: scrollPct(),
        },
      });
    };

    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const state = sectionState.get((entry.target as HTMLElement).dataset.trackSection ?? "");
        if (!state) continue;
        state.maxVisiblePct = Math.max(state.maxVisiblePct, Math.round(entry.intersectionRatio * 100));
        if (entry.isIntersecting && state.since === null) state.since = Date.now();
        else if (!entry.isIntersecting && state.since !== null) {
          state.visibleMs += Date.now() - state.since;
          state.since = null;
        }
      }
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    for (const element of sectionElements) if (observer && element.dataset.trackSection) observer.observe(element);

    const payload = (exit: boolean) => {
      addVisibleTime();
      addSectionTime();
      const sections = [...sectionState.entries()].map(([id, state]) => ({
        id,
        title: state.title,
        visibleMs: Math.round(state.visibleMs),
        maxVisiblePct: state.maxVisiblePct,
        isExit: false,
      }));
      const longest = sections.slice().sort((a, b) => b.visibleMs - a.visibleMs)[0];
      const exitSection = longest?.id ?? headingAtViewport();
      if (exit) for (const section of sections) section.isExit = section.id === exitSection;
      const now = Date.now();
      if (now - lastScrollAt > 1200) stops.push({ pct: lastScrollPct, ms: now - lastScrollAt });
      send({
        type: "duration",
        path: pathname,
        viewId,
        exit,
        visibleMs: Math.round(visibleMs),
        activeMs: Math.round(activeMs),
        maxScrollPct: maxScroll,
        lastScrollPct,
        scrollStops: stops.slice(-20),
        stoppedSection: longest?.title ?? headingAtViewport(),
        exitSection,
        clickCount,
        sections: exit ? sections : undefined,
      });
      if (exit) finished = true;
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        addVisibleTime();
        addSectionTime();
        payload(false);
      } else {
        startVisibleTime();
        lastActivity = Date.now();
      }
    };
    const onPageHide = () => {
      if (!finished) payload(true);
    };

    document.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    activity();

    return () => {
      if (!finished) payload(true);
      document.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      observer?.disconnect();
      open.current = null;
      activeViewId = null;
    };
  }, [pathname]);

  useEffect(() => {
    // Core Web Vitals as this browser measured them. PerformanceObserver is native, so
    // this costs no dependency; a browser that lacks an entry type simply reports less.
    const observers: PerformanceObserver[] = [];
    const report = (metric: string, value: number, good: number, poor: number) => {
      send({ type: "vital", metric, value, rating: value <= good ? "good" : value <= poor ? "needs-improvement" : "poor", path: window.location.pathname });
    };

    const observe = (type: string, handler: (list: PerformanceObserverEntryList) => void) => {
      try {
        const observer = new PerformanceObserver(handler);
        observer.observe({ type, buffered: true });
        observers.push(observer);
      } catch {
        // Unsupported entry type in this browser; nothing to report and nothing to fix.
      }
    };

    let lcp = 0;
    let cls = 0;
    observe("largest-contentful-paint", (list) => { lcp = list.getEntries().at(-1)?.startTime ?? lcp; });
    observe("layout-shift", (list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) cls += entry.value;
      }
    });
    observe("paint", (list) => {
      const fcp = list.getEntries().find((entry) => entry.name === "first-contentful-paint");
      if (fcp) report("FCP", fcp.startTime, 1800, 3000);
    });
    observe("navigation", (list) => {
      const nav = list.getEntries()[0] as PerformanceNavigationTiming | undefined;
      if (nav) report("TTFB", nav.responseStart, 800, 1800);
    });
    observe("event", (list) => {
      // INP approximated by the worst interaction latency seen; the exact percentile
      // definition needs the web-vitals library, and the worst case is the useful signal.
      const worst = Math.max(...list.getEntries().map((entry) => (entry as PerformanceEventTiming).duration ?? 0), 0);
      if (worst > 0) report("INP", worst, 200, 500);
    });

    // The final values for LCP and CLS are only known once the page stops being looked at.
    const settle = () => {
      if (document.visibilityState !== "hidden") return;
      if (lcp > 0) { report("LCP", lcp, 2500, 4000); lcp = 0; }
      if (cls > 0) { report("CLS", cls, 0.1, 0.25); cls = 0; }
    };
    document.addEventListener("visibilitychange", settle);
    return () => {
      document.removeEventListener("visibilitychange", settle);
      for (const observer of observers) observer.disconnect();
    };
  }, []);

  return null;
}
