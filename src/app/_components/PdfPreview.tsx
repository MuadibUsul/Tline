"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Reads a report's PDF on the page.
 *
 * The document is drawn with pdf.js rather than handed to an <iframe>: an embedded PDF
 * relies on the browser having a viewer of its own, and where there is none — some mobile
 * browsers, and any environment with the plugin disabled — the frame shows a broken file
 * instead of the report. Drawing to a canvas works the same everywhere.
 *
 * Each draw renders into a canvas of its own and swaps it in when finished. Sharing one
 * canvas between draws deadlocks pdf.js: two renders aimed at the same canvas neither
 * resolve nor reject, and the page stays blank with nothing to report. React runs effects
 * twice in development, so that overlap is the normal case rather than an edge one.
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
  previous: string;
  next: string;
  zoomIn: string;
  zoomOut: string;
}

type PdfDocument = {
  numPages: number;
  getPage: (index: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};
type PdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvas: HTMLCanvasElement; viewport: unknown }) => { promise: Promise<void>; cancel: () => void };
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

export default function PdfPreview({ src, labels }: { src: string; labels: Labels }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        loaded = (await pdfjs.getDocument({
          url: src,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise) as unknown as PdfDocument;
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        documentRef.current = loaded;
        setPageCount(loaded.numPages);
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
      if (documentRef.current === loaded) documentRef.current = null;
      void loaded?.destroy();
    };
  }, [src]);

  useEffect(() => {
    if (state !== "ready") return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;

    void (async () => {
      const source = documentRef.current;
      const holder = holderRef.current;
      if (!source || !holder) return;

      const target = await source.getPage(page);
      if (cancelled) return;

      // Drawn at the display's pixel density and scaled back with CSS, or the text is
      // soft on the screens most people read on.
      const density = Math.min(2, window.devicePixelRatio || 1);
      const viewport = target.getViewport({ scale: scale * density });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / density)}px`;
      canvas.style.height = `${Math.floor(viewport.height / density)}px`;

      // The canvas itself, not its 2D context: given both, pdf.js paints the page
      // background and nothing else.
      const render = target.render({ canvas, viewport });
      task = render;
      await render.promise;
      if (cancelled) return;
      holder.replaceChildren(canvas);
      setDrawn(true);
    })().catch((error: unknown) => {
      // A cancelled render is this component superseding it, not a failure to show.
      if (cancelled || (error instanceof Error && /cancel/i.test(error.message))) return;
      setState("failed");
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [state, page, scale]);

  if (state === "failed") return <p className="pdf-viewer-state">{labels.failed}</p>;

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-bar">
        <button type="button" className="minibtn" onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page <= 1} aria-label={labels.previous}>←</button>
        <span className="pdf-viewer-page">
          {labels.page} {page} {labels.of} {pageCount || "…"}
        </span>
        <button type="button" className="minibtn" onClick={() => setPage((n) => Math.min(pageCount || 1, n + 1))} disabled={page >= pageCount} aria-label={labels.next}>→</button>
        <span className="pdf-viewer-spacer" />
        <button type="button" className="minibtn" onClick={() => setScale((s) => Math.max(MIN_SCALE, +(s - 0.2).toFixed(2)))} disabled={scale <= MIN_SCALE} aria-label={labels.zoomOut}>−</button>
        <span className="pdf-viewer-zoom">{Math.round(scale * 100)}%</span>
        <button type="button" className="minibtn" onClick={() => setScale((s) => Math.min(MAX_SCALE, +(s + 0.2).toFixed(2)))} disabled={scale >= MAX_SCALE} aria-label={labels.zoomIn}>＋</button>
      </div>
      <div className="pdf-viewer-page-area">
        {!drawn && <p className="pdf-viewer-state">{labels.loading}</p>}
        <div ref={holderRef} />
      </div>
    </div>
  );
}
