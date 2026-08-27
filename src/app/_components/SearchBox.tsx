"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SearchBox({ initial = "", autoFocus = false, placeholder, ariaLabel }: { initial?: string; autoFocus?: boolean; placeholder: string; ariaLabel: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <form
      className="searchbar"
      style={{ cursor: "text" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <span>⌕</span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={autoFocus}
        placeholder={placeholder}
        style={{
          border: "none", outline: "none", background: "transparent",
          font: "inherit", color: "var(--ink)", flex: 1, minWidth: 0,
        }}
        aria-label={ariaLabel}
      />
    </form>
  );
}
