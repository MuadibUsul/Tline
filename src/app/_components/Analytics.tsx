"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * The audience beacon.
 *
 * No cookie is set and no identifier is persisted beyond the tab: the session id lives in
 * `sessionStorage` and is reset after thirty idle minutes, which is how one reader's visit
 * is stitched together without anything that survives the browser being closed. Who the
 * visitor is, where they are and what they are using is decided on the server from the
 * request itself, so this file sends only what the server cannot know: the page, the
 * referrer, the campaign and how long the page was actually looked at.
 */

const ENDPOINT = "/api/analytics";
const SESSION_KEY = "tline_analytics_session";
const IDLE_MS = 30 * 60_000;

type Payload = Record<string, unknown>;

function send(payload: Payload) {
  try {
    const body = JSON.stringify({ ...payload, session: session().id });
    // A page being closed is exactly when a normal fetch is cancelled, which is the one
    // moment the duration beacon has to survive. sendBeacon is queued by the browser and
    // outlives the document; fetch with keepalive is the fallback.
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
 * session id, and their first page is an entry again. Keying it off the key's existence
 * would have made every returning visit look like a continuation and quietly halved the
 * bounce rate.
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
    const id = Math.random().toString(36).slice(2) + now.toString(36);
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
    if (!pathname) return;
    // Read before `send`, which is what creates the session when there is none.
    const entry = session().fresh;
    send({ type: "pageview", path: pathname, referrer: document.referrer || undefined, entry, ...campaign() });
    open.current = { path: pathname, since: Date.now() };

    const flush = () => {
      const current = open.current;
      if (!current) return;
      const elapsed = Date.now() - current.since;
      // Under a second is a bounce off a mistaken click, not a reading. Reporting it would
      // drag the average down with time nobody spent.
      if (elapsed >= 1000) send({ type: "duration", path: current.path, durationMs: elapsed });
      current.since = Date.now();
    };

    // `visibilitychange` rather than `unload`: on mobile a tab is usually backgrounded and
    // then discarded, and `unload` never runs for it.
    const onHidden = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flush);
      open.current = null;
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
