"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reads a report's PDF as part of the article, not as a viewer beside it.
 *
 * There is no toolbar, page counter, zoom control or inner scrollbar: the pages stack in
 * the normal document flow at the article's width, so the report reads like the page it
 * belongs to. Pages are drawn only as they come near the viewport, and the document starts
 * loading while the reader is still in the analysis above, so arriving at the report rarely
 * meets a spinner.
 *
 * pdf.js is used rather than an <iframe> because an embedded PDF relies on the browser's
 * viewer; where there is none, the frame shows a broken file. The worker and font data are
 * served from this origin because the content policy admits no other source.
 */

interface Labels {
  loading: string;
  failed: string;
}

type PdfDocument = {
  numPages: number;
  getPage: (index: number) => Promise<PdfPage>;
};
/** What getDocument returns. The document it resolves to has no destroy of its own —
 *  calling one there threw on unmount and took the page with it, so going back from a
 *  report landed on an error instead of the page behind it. */
type PdfLoadingTask = { promise: Promise<unknown>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvas: HTMLCanvasElement; viewport: unknown }) => { promise: Promise<void>; cancel: () => void };
};

// Start drawing a page before it is on screen, so scrolling meets a drawn page.
const PRELOAD_MARGIN = "900px";
// The document also starts loading after the article becomes idle, rather than waiting
// for the reader to reach the report. A report page is part of the article, and fetching
// its first chunks while someone reads the analysis is what removes the visible wait.
const IDLE_TIMEOUT_MS = 2200;

export default function PdfPreview({ src, labels }: { src: string; labels: Labels }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const holders = useRef(new Map<number, HTMLDivElement>());
  const drawn = useRef(new Map<number, number>());
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
  const [width, setWidth] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [enabled, setEnabled] = useState(false);

  // Two starts, whichever comes first: the page is near, or the article has gone idle.
  useEffect(() => {
    const start = () => setEnabled(true);
    const node = containerRef.current;
    let observer: IntersectionObserver | undefined;
    if (node && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          start();
          observer?.disconnect();
        }
      }, { rootMargin: PRELOAD_MARGIN });
      observer.observe(node);
    }
    const requestIdle = (window as Window & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    const cancelIdle = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    let idle: number;
    if (typeof requestIdle === "function") idle = requestIdle(start, { timeout: IDLE_TIMEOUT_MS });
    else idle = window.setTimeout(start, IDLE_TIMEOUT_MS);
    return () => {
      observer?.disconnect();
      if (typeof requestIdle === "function" && cancelIdle) cancelIdle(idle);
      else clearTimeout(idle);
    };
  }, []);

  // The report fills the article column; measure it so each page is drawn at its width.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let task: PdfLoadingTask | null = null;
    let loaded: PdfDocument | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        task = pdfjs.getDocument({
          url: src,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          // The route answers Range requests. Without these pdf.js streams the whole file
          // on its opening request before drawing page one; with them it cancels that
          // stream after the headers and fetches only the chunks a page needs.
          disableAutoFetch: true,
          disableStream: true,
          rangeChunkSize: 524288,
        }) as unknown as PdfLoadingTask;
        loaded = (await task.promise) as PdfDocument;
        if (cancelled) return;
        // Most reports use one page size. Seed placeholders from page one and refine
        // exceptional pages lazily instead of opening every page before showing the PDF.
        const first = (await loaded.getPage(1)).getViewport({ scale: 1 });
        const measured = Array.from({ length: loaded.numPages }, () => ({ width: first.width, height: first.height }));
        if (cancelled) return;
        documentRef.current = loaded;
        setSizes(measured);
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
      if (documentRef.current === loaded) documentRef.current = null;
      try {
        void task?.destroy().catch(() => {});
      } catch {
        /* the document is going away regardless */
      }
    };
  }, [src, enabled]);

  const drawPage = useCallback(async (index: number) => {
    const source = documentRef.current;
    const holder = holders.current.get(index);
    if (!source || !holder || width <= 0 || drawn.current.get(index) === width) return;
    drawn.current.set(index, width);

    const page = await source.getPage(index);
    const natural = page.getViewport({ scale: 1 });
    setSizes((current) => current[index - 1]?.width === natural.width && current[index - 1]?.height === natural.height
      ? current
      : current.map((size, position) => position === index - 1 ? { width: natural.width, height: natural.height } : size));
    // Draw at the article width, with enough physical pixels to stay crisp on ordinary
    // desktop displays. The sheet itself is sized by CSS.
    const density = Math.min(2.5, Math.max(1.5, window.devicePixelRatio || 1));
    const viewport = page.getViewport({ scale: (width / natural.width) * density });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    await page.render({ canvas, viewport }).promise;
    holder.replaceChildren(canvas);
  }, [width]);

  // A width change invalidates every drawn page; the observer redraws what is on screen.
  useEffect(() => {
    drawn.current.clear();
  }, [width]);

  useEffect(() => {
    if (state !== "ready" || sizes.length === 0 || width <= 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.page);
          if (!index) continue;
          if (!entry.isIntersecting) {
            entry.target.replaceChildren();
            drawn.current.delete(index);
            continue;
          }
          void drawPage(index).catch(() => {
            drawn.current.delete(index);
          });
        }
      },
      { rootMargin: PRELOAD_MARGIN, root: null },
    );
    for (const holder of holders.current.values()) observer.observe(holder);
    // The first page is drawn outright rather than waited for: an observer that never
    // fires would otherwise leave the reader looking at an empty sheet.
    void drawPage(1).catch(() => drawn.current.delete(1));
    return () => observer.disconnect();
  }, [state, sizes.length, width, drawPage]);

  if (state === "failed") return <p className="pdf-viewer-state">{labels.failed}</p>;

  return (
    <div className="pdf-viewer" ref={containerRef}>
      {state === "loading" && (
        <div className="pdf-viewer-loading" aria-live="polite">
          <div className="pdf-viewer-loading-page" aria-hidden="true">
            <span className="skeleton" style={{ width: "34%", height: 20, marginBottom: 8 }} />
            <span className="skeleton" style={{ width: "88%", height: 11 }} />
            <span className="skeleton" style={{ width: "94%", height: 11 }} />
            <span className="skeleton" style={{ width: "82%", height: 11 }} />
            <span className="skeleton" style={{ width: "90%", height: 11, marginTop: 18 }} />
            <span className="skeleton" style={{ width: "86%", height: 11 }} />
          </div>
          <p className="pdf-viewer-state">{labels.loading}</p>
        </div>
      )}
      {state === "ready" && (
        <div className="pdf-viewer-pages">
          {sizes.map((size, position) => {
            const index = position + 1;
            return (
              <div
                key={index}
                className="pdf-viewer-sheet"
                data-page={index}
                // The page's own aspect ratio holds the space before it is drawn.
                style={{ aspectRatio: `${size.width} / ${size.height}` }}
                ref={(node) => {
                  if (node) holders.current.set(index, node);
                  else holders.current.delete(index);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
