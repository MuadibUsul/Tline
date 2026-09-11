"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface AdminNavItem {
  /** Address to navigate to, already carrying the language prefix. */
  href: string;
  /** The same address without a language prefix, which is what `active` compares. */
  match: string;
  label: string;
  hint?: string;
}

export interface AdminNavGroup {
  title: string;
  items: AdminNavItem[];
}

/** The language prefix is part of every address here; matching ignores it. */
function bare(pathname: string): string {
  const [, first, ...rest] = pathname.split("/");
  if (first !== "en" && first !== "zh") return pathname;
  return rest.length ? `/${rest.join("/")}` : "/";
}

/**
 * `/admin` is the console root, so a prefix match would light it up on every page.
 * Everything below it does match by prefix, so a detail page keeps its section marked.
 */
function isActive(current: string, match: string): boolean {
  return match === "/admin" ? current === "/admin" : current === match || current.startsWith(`${match}/`);
}

export default function AdminNav({ groups }: { groups: AdminNavGroup[] }) {
  const current = bare(usePathname() || "/admin");
  return (
    <nav className="admin-nav" aria-label="管理后台">
      {groups.map((group) => (
        <div className="admin-nav-group" key={group.title}>
          <span className="admin-nav-title">{group.title}</span>
          {group.items.map((item) => {
            const active = isActive(current, item.match);
            return (
              <Link
                key={item.match}
                href={item.href}
                className={`admin-nav-link${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span>{item.label}</span>
                {item.hint && <small>{item.hint}</small>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
