"use client";
import { useEffect } from "react";

/**
 * The last boundary, for failures above the page-level one — including a page whose
 * scripts a release has replaced.
 *
 * Without this, such a failure shows the framework's own bare notice, which offers the
 * reader nothing to do. A missing chunk is not a fault in the page: the code it is asking
 * for has simply been superseded, and reloading fetches the version now being served. It
 * reloads once, guarded by a flag, so a genuinely broken build cannot put the browser in
 * a loop.
 */
const RELOAD_MARK = "tline-reloaded-after-stale-build";

// This boundary renders above the root layout, so it cannot rely on globals.css. Keep
// the palette local, but let the reader's system scheme choose the light or dark pair.
const STYLE = `
  :root{color-scheme:light dark}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f7f8f8;color:#08090a}
  .ge-main{max-width:560px;margin:18vh auto;padding:0 24px}
  .ge-kicker{margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#5f6670}
  .ge-title{margin:10px 0 12px;font-size:24px;font-weight:600;color:#08090a}
  .ge-copy{margin:0 0 20px;line-height:1.7;color:#3c4149}
  .ge-action{padding:9px 16px;border:1px solid #5e6ad2;border-radius:7px;background:#5e6ad2;color:#fff;font:inherit;font-weight:600;cursor:pointer}
  .ge-action:focus-visible{outline:2px solid #5e6ad2;outline-offset:2px}
  @media (prefers-color-scheme:dark){
    body{background:#0c0e13;color:#e6e8ee}
    .ge-kicker{color:#a8b0c2}
    .ge-title{color:#e6e8ee}
    .ge-copy{color:#a8b0c2}
    .ge-action{border-color:#7c8aff;background:#7c8aff;color:#08090a}
    .ge-action:focus-visible{outline-color:#a4aeff}
  }
`;

function isStaleBuild(error: Error) {
  return /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    `${error.name} ${error.message}`,
  );
}

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!isStaleBuild(error)) return;
    try {
      if (sessionStorage.getItem(RELOAD_MARK)) return;
      sessionStorage.setItem(RELOAD_MARK, "1");
    } catch {
      // Private browsing denies storage; one reload is still better than a dead page.
    }
    window.location.reload();
  }, [error]);

  return (
    <html lang="en">
      <head>
        <style>{STYLE}</style>
      </head>
      <body>
        <main className="ge-main" role="alert">
          <p className="ge-kicker">Error · 错误</p>
          <h1 className="ge-title">This page could not be loaded. 页面无法加载。</h1>
          <p className="ge-copy">Stored data is unaffected. 已存储数据未受影响。</p>
          <button
            type="button"
            className="ge-action"
            onClick={() => { reset(); window.location.reload(); }}
          >
            Reload · 重新加载
          </button>
        </main>
      </body>
    </html>
  );
}
