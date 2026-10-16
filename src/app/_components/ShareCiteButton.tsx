"use client";

import { useState } from "react";

/**
 * Copy a citation or the link (PRD P03: 引文复制可生成 标题/机构/日期/Tlines URL/原始 URL)。
 * Everything copied comes from props the server already rendered — no client fetch, and
 * the citation text is the same in the clipboard as in the metadata a reader sees.
 */
export default function ShareCiteButton({
  citation,
  labels,
}: {
  citation: string;
  labels: { cite: string; copied: string; copyLink: string; linkCopied: string };
}) {
  const [state, setState] = useState<"idle" | "cite" | "link">("idle");

  const copy = async (text: string, which: "cite" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      setState(which);
      setTimeout(() => setState("idle"), 1800);
    } catch {
      /* clipboard unavailable (insecure context): leave the buttons as they were */
    }
  };

  return (
    <span className="ed-actions">
      <button type="button" className="minibtn ed-cite" onClick={() => void copy(citation, "cite")}>
        {state === "cite" ? labels.copied : labels.cite}
      </button>
      <button type="button" className="minibtn ed-cite" onClick={() => void copy(window.location.href, "link")}>
        {state === "link" ? labels.linkCopied : labels.copyLink}
      </button>
    </span>
  );
}
