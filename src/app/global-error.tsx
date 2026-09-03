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
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif", background: "#0c0e13", color: "#e6e8ee" }}>
        <main style={{ maxWidth: 560, margin: "18vh auto", padding: "0 24px" }} role="alert">
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#8b93a7", margin: 0 }}>Error · 错误</p>
          <h1 style={{ fontSize: 24, margin: "10px 0 12px", fontWeight: 600 }}>
            This page could not be loaded. 页面无法加载。
          </h1>
          <p style={{ color: "#a8b0c2", lineHeight: 1.7, margin: "0 0 20px" }}>
            Stored data is unaffected. 已存储数据未受影响。
          </p>
          <button
            type="button"
            onClick={() => { reset(); window.location.reload(); }}
            style={{ padding: "9px 16px", borderRadius: 7, border: "1px solid #2f55d4", background: "#2f55d4", color: "#fff", font: "inherit", fontWeight: 600, cursor: "pointer" }}
          >
            Reload · 重新加载
          </button>
        </main>
      </body>
    </html>
  );
}
