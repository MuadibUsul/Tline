import type { ReactNode } from "react";

export type IconName =
  | "arrow-right"
  | "bell"
  | "canvas"
  | "check"
  | "close"
  | "external"
  | "menu"
  | "image"
  | "minus"
  | "plus"
  | "pulse"
  | "resize"
  | "search"
  | "sparkles"
  | "theme"
  | "trash";

function paths(name: IconName): ReactNode {
  switch (name) {
    case "search": return <><circle cx="10.5" cy="10.5" r="5.75" /><path d="m15 15 4.25 4.25" /></>;
    case "arrow-right": return <><path d="M5 12h13" /><path d="m14 7 5 5-5 5" /></>;
    case "canvas": return <><path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3" /><path d="M9 9h6v6H9z" /></>;
    case "pulse": return <path d="M3.5 12h4l2-5.5 4.5 11 2.2-5.5h4.3" />;
    case "bell": return <><path d="M6.5 16.5h11l-1.2-1.8V10a4.3 4.3 0 0 0-8.6 0v4.7l-1.2 1.8Z" /><path d="M10 19h4" /></>;
    case "image": return <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.3" /><path d="m6.5 17 4-4 2.7 2.7 1.8-1.8 2.5 3.1" /></>;
    case "external": return <><path d="M13 5h6v6" /><path d="m19 5-8 8" /><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" /></>;
    case "check": return <path d="m5 12.5 4.2 4L19 6.75" />;
    case "close": return <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>;
    case "menu": return <><path d="M5 7h14" /><path d="M5 12h14" /><path d="M5 17h14" /></>;
    case "plus": return <><path d="M12 5v14" /><path d="M5 12h14" /></>;
    case "minus": return <path d="M5 12h14" />;
    case "resize": return <><path d="m10 19 9-9" /><path d="m14 19 5-5" /><path d="M18 19h1v-1" /></>;
    case "sparkles": return <><path d="M12 3.5c.5 3.4 2.1 5 5.5 5.5-3.4.5-5 2.1-5.5 5.5-.5-3.4-2.1-5-5.5-5.5 3.4-.5 5-2.1 5.5-5.5Z" /><path d="M18.5 14.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3Z" /></>;
    case "theme": return <><circle cx="12" cy="12" r="7.5" /><path d="M12 4.5a7.5 7.5 0 0 0 0 15V4.5Z" fill="currentColor" stroke="none" /></>;
    case "trash": return <><path d="M6.5 8h11l-.7 11h-9.6L6.5 8Z" /><path d="M5 8h14" /><path d="M9 8V5h6v3" /><path d="M10 11.5v4.5M14 11.5v4.5" /></>;
  }
}

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon icon-${name} ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths(name)}
    </svg>
  );
}

export function TlinesMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`brand-mark ${className}`.trim()} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <path d="M6.5 6.5h15M9 6.5v15M19 6.5v15M6.5 21.5h15" />
      <path className="brand-mark-signal" d="m12 11 4 3-4 3" />
    </svg>
  );
}
