"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Acknowledge a same-origin navigation immediately without a Suspense boundary.
 *
 * A route-level loading.tsx streams the shell with a 200 before the page can call
 * notFound(), so a withdrawn report answered 200 with a "not found" body. This bar gives
 * the click the same instant feedback without deciding the response status; the server
 * still gets to answer 404 when the report does not exist.
 */
export default function NavigationProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setActive(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setActive(false), 12_000);
    return () => clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    setActive(false);
  }, [pathname]);

  return <div className={`nav-progress${active ? " on" : ""}`} aria-hidden="true" />;
}
