"use client";

import { useEffect } from "react";

/**
 * Header hide-on-scroll (PRD §7): the top bar retreats while reading down and returns the
 * moment the reader scrolls up — a reading aid, not an animation. Disabled entirely under
 * prefers-reduced-motion.
 */
export default function TopbarScroll({ selector = ".topbar" }: { selector?: string }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bar = document.querySelector<HTMLElement>(selector);
    if (!bar) return;
    let last = window.scrollY;
    let ticking = false;
    const update = () => {
      ticking = false;
      const current = window.scrollY;
      const delta = current - last;
      if (current < 120) bar.classList.remove("hide");
      else if (delta > 6) bar.classList.add("hide");
      else if (delta < -6) bar.classList.remove("hide");
      last = current;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [selector]);
  return null;
}
