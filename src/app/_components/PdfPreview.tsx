"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reads a report's PDF on the page.
 *
 * The document is drawn with pdf.js rather than handed to an <iframe>: an embedded PDF
 * relies on the browser having a viewer of its own, and where there is none — some mobile
 * browsers, and any environment with the plugin disabled — the frame shows a broken file
 * instead of the report. Drawing to a canvas works the same everywhere.
 *
 * Pages are stacked and scrolled through, the way a document is read. Each is drawn only
 * as it comes near the viewport, so opening a fifty-page report costs one page of work
 * rather than fifty, and each draw renders into a canvas of its own: two renders aimed at
 * one canvas deadlock inside pdf.js, resolving neither way.
 *
 * The worker and font data are served from this origin because the content policy admits
 * no other source, and because pdf.js otherwise looks for them beside its own bundled
 * module, where they are not — a document whose fonts never arrive renders as a blank
 * sheet with nothing logged to explain it.
 */

interface Labels {
  loading: string;
  failed: string;
  page: string;
  of: string;
  zoomIn: string;
  zoomOut: string;
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

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
// Start drawing a page before it is on screen, so scrolling meets a drawn page.
const PRELOAD_MARGIN = "600px";

export default function PdfPreview({ src, labels }: { src: string; labels: Labels }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const holders = useRef(new Map<number, HTMLDivElement>());
  const drawn = useRef(new Map<number, number>());
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
  const [scale, setScale] = useState(1.25);
  const [current, setCurrent] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
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
      // Guarded because this runs while the browser is navigating away: anything thrown
      // here surfaces as a failed navigation rather than as a viewer that failed to tidy
      // up, which is how the back button came to land on an error page.
      try {
        void task?.destroy().catch(() => {});
      } catch {
        /* the document is going away regardless */
      }
    };
  }, [src]);

  const drawPage = useCallback(async (index: number) => {
    const source = documentRef.current;
    const holder = holders.current.get(index);
    if (!source || !holder || drawn.current.get(index) === scale) return;
    drawn.current.set(index, scale);

    const page = await source.getPage(index);
    const natural = page.getViewport({ scale: 1 });
    setSizes((current) => current[index - 1]?.width === natural.width && current[index - 1]?.height === natural.height
      ? current
      : current.map((size, position) => position === index - 1 ? { width: natural.width, height: natural.height } : size));
    // A CSS-sized canvas at 1x is visibly soft on ordinary desktop displays. Render at
    // least two physical pixels per CSS pixel, while bounding memory on high-DPI screens.
    const density = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    const viewport = page.getViewport({ scale: scale * density });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    // The canvas itself, not its 2D context: given both, pdf.js paints the page
    // background and nothing else.
    await page.render({ canvas, viewport }).promise;
    holder.replaceChildren(canvas);
  }, [scale]);

  // Zooming invalidates what is drawn; the observer redraws whatever is on screen.
  useEffect(() => {
    drawn.current.clear();
  }, [scale]);

  useEffect(() => {
    if (state !== "ready" || sizes.length === 0) return;
    const root = scrollRef.current;
    if (!root) return;

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
      { root, rootMargin: PRELOAD_MARGIN },
    );
    for (const holder of holders.current.values()) observer.observe(holder);
    // The first page is drawn outright rather than waited for: an observer that never
    // fires would otherwise leave the reader looking at an empty sheet.
    void drawPage(1).catch(() => drawn.current.delete(1));

    // The page number follows the scroll rather than a button. Measured against the
    // scroll box itself: offsetTop is relative to whichever ancestor happens to be
    // positioned, which is not necessarily this one.
    const onScroll = () => {
      const marker = root.getBoundingClientRect().top + root.clientHeight * 0.3;
      let page = 1;
      for (const [index, holder] of holders.current) {
        if (holder.getBoundingClientRect().top <= marker) page = Math.max(page, index);
      }
      setCurrent(page);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", onScroll);
    };
  }, [state, sizes.length, drawPage]);

  if (state === "failed") return <p className="pdf-viewer-state">{labels.failed}</p>;

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-bar">
        <span className="pdf-viewer-page">
          {labels.page} {current} {labels.of} {sizes.length || "…"}
        </span>
        <span className="pdf-viewer-spacer" />
        <button type="button" className="minibtn" onClick={() => setScale((s) => Math.max(MIN_SCALE, +(s - 0.2).toFixed(2)))} disabled={scale <= MIN_SCALE} aria-label={labels.zoomOut}>−</button>
        <span className="pdf-viewer-zoom">{Math.round(scale * 100)}%</span>
        <button type="button" className="minibtn" onClick={() => setScale((s) => Math.min(MAX_SCALE, +(s + 0.2).toFixed(2)))} disabled={scale >= MAX_SCALE} aria-label={labels.zoomIn}>＋</button>
      </div>
      <div className="pdf-viewer-page-area" ref={scrollRef}>
        {state === "loading" && <p className="pdf-viewer-state">{labels.loading}</p>}
        <div className="pdf-viewer-pages" style={{ width: `${Math.round(Math.max(1, ...sizes.map((size) => size.width)) * scale)}px` }}>
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
      </div>
    </div>
  );
}
