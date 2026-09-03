"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { FeedPulse } from "@/lib/queries";

// How far down the page still counts as "watching the top of the feed". Below this the
// reader is mid-article and swapping the list under them would lose their place, so the
// update waits behind a button instead.
const TOP_OF_FEED_PX = 240;

/**
 * Keeps a server-rendered feed current without a page reload.
 *
 * The page is already dynamic, so there is nothing to reconcile client-side: when the
 * poll reports something new, router.refresh() re-runs the server components and React
 * swaps in the new markup, keeping scroll position and any open state. Polling beats a
 * push channel here because the answer is almost always "nothing new", and an idle
 * connection per open tab is a real cost on a single small host.
 */
export default function LiveFeed({
  initial,
  intervalMs = 30_000,
  label,
  ariaLabel,
}: {
  initial: FeedPulse;
  intervalMs?: number;
  label: string;
  ariaLabel: string;
}) {
  const router = useRouter();
  // Seeded with what the server actually rendered, so an article published between that
  // render and the first poll still registers as new.
  const baseline = useRef<FeedPulse>(initial);
  const instance = useRef<string | null>(null);
  const [pending, setPending] = useState(false);

  const apply = useCallback(() => {
    setPending(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    router.refresh();
  }, [router]);

  useEffect(() => {
    baseline.current = initial;
    setPending(false);
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      // A hidden tab is not worth a request; the visibility listener polls on return.
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/feed/pulse", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const pulse: FeedPulse = await response.json();
        // A release replaces the scripts this page is running. Refreshing in place would
        // ask for a chunk that is no longer served and leave the reader on an error
        // screen, so the page is reloaded outright instead.
        if (pulse.instance) {
          if (!instance.current) instance.current = pulse.instance;
          else if (instance.current !== pulse.instance) {
            window.location.reload();
            return;
          }
        }
        const previous = baseline.current;
        if (pulse.latestId === previous.latestId && pulse.total === previous.total) return;
        baseline.current = pulse;
        if (window.scrollY <= TOP_OF_FEED_PX) router.refresh();
        else setPending(true);
      } catch {
        // A failed poll is not worth surfacing: the next tick retries.
      }
    };

    const schedule = () => {
      timer = setTimeout(async () => {
        await poll();
        if (!cancelled) schedule();
      }, intervalMs);
    };

    void poll();
    schedule();
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, router]);

  if (!pending) return null;

  return (
    <button type="button" className="livepill" onClick={apply} aria-label={ariaLabel}>
      <span className="dot" aria-hidden="true" />
      {label}
    </button>
  );
}
