"use client";

export default function ThemeToggle() {
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
      aria-label="Toggle theme"
    >
      ◐ Theme
    </button>
  );
}
