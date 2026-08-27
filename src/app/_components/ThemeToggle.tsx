"use client";

export default function ThemeToggle({ label, ariaLabel }: { label: string; ariaLabel: string }) {
  function toggle() {
    const r = document.documentElement;
    const cur = r.getAttribute("data-theme");
    const next =
      cur === "dark" ? "light" : cur === "light" ? "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark";
    r.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch {}
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="minibtn"
      aria-label={ariaLabel}
    >
      ◐ <span className="control-label">{label}</span>
    </button>
  );
}
