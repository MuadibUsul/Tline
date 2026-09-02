"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface MobileNavItem {
  href: string;
  label: string;
}

/**
 * Below 720px the desktop `.nav` row is hidden, so every primary destination and the
 * account controls have to live here — this drawer is the only way in on a phone.
 */
export default function MobileNav({
  items,
  openLabel,
  closeLabel,
  menuLabel,
  children,
}: {
  items: MobileNavItem[];
  openLabel: string;
  closeLabel: string;
  menuLabel: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // A tap on a link navigates without unmounting the layout; close on every route change.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || toggleRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="minibtn mobile-nav-toggle"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? closeLabel : openLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? "✕" : "☰"}</span>
      </button>

      <div
        id="mobile-nav-panel"
        ref={panelRef}
        className="mobile-nav-panel"
        role="dialog"
        aria-modal="true"
        aria-label={menuLabel}
        hidden={!open}
      >
        <nav className="mobile-nav-links" aria-label={menuLabel}>
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {children ? <div className="mobile-nav-account">{children}</div> : null}
      </div>
    </>
  );
}
