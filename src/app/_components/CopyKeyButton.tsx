"use client";

import { useState } from "react";

/** Copies a stored key. The full secret stays available for the life of the key. */
export default function CopyKeyButton({ value, label = "Copy", copiedLabel = "Copied" }: {
  value: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="minibtn"
      onClick={() => {
        void navigator.clipboard?.writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
