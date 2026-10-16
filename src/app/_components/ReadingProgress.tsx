"use client";

import { useEffect, useState } from "react";

/** A two-pixel reading-progress bar on long-form pages (quiet; PRD §7 "轻量指示"). */
export default function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const update = () => {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(height > 0 ? Math.min(100, Math.max(0, (window.scrollY / height) * 100)) : 0);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return <div className="ed-progress" style={{ width: `${progress}%` }} aria-hidden="true" />;
}
