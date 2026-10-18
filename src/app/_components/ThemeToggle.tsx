"use client";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";

export default function ThemeToggle({ label, ariaLabel }: { label: string; ariaLabel: string }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const explicit = root.getAttribute("data-theme");
    setDark(explicit === "dark" || (!explicit && window.matchMedia("(prefers-color-scheme: dark)").matches));
  }, []);

  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch {}
    setDark(!dark);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="minibtn"
      aria-label={ariaLabel}
      aria-pressed={dark}
    >
      <Icon name="theme" /> <span className="control-label">{label}</span>
    </button>
  );
}
