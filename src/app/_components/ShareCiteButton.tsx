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
  labels: { cite: string; copied: string; copyLink: string; linkCopied: string; copyFailed: string };
}) {
  const [state, setState] = useState<"idle" | "cite" | "link" | "failed">("idle");

  const copy = async (text: string, which: "cite" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      setState(which);
      setTimeout(() => setState("idle"), 1800);
    } catch {
      // Clipboard permission can be denied even on HTTPS. Silence made the button look
      // dead; say so instead.
      setState("failed");
      setTimeout(() => setState("idle"), 2400);
    }
  };

  return (
    <span className="ed-actions">
      <button type="button" className="minibtn ed-cite" onClick={() => void copy(citation, "cite")}>
        {state === "cite" ? labels.copied : state === "failed" ? labels.copyFailed : labels.cite}
      </button>
      <button type="button" className="minibtn ed-cite" onClick={() => void copy(window.location.href, "link")}>
        {state === "link" ? labels.linkCopied : state === "failed" ? labels.copyFailed : labels.copyLink}
      </button>
    </span>
  );
}
