"use client";

// Renders a PDF page by page and lets the caller draw on top of each page. Positions
// are percentages of the page (from the top-left), so overlays stay put at any width.
// pdf.js is loaded in the browser only; the page is drawn to a canvas.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DRAW_MARGIN_PX, pageBox, pageWidth } from "@/lib/signing/pdf-layout";

export interface PageInfo {
  /** 1-based. */
  page: number;
  /** Rendered size in CSS pixels. */
  width: number;
  height: number;
}

type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;

function PageCanvas({
  doc,
  page,
  maxWidth,
  ratio,
  children,
}: {
  doc: PdfDoc;
  page: number;
  maxWidth: number;
  /** Height over width of the first page: the box every page holds until it is drawn. */
  ratio: number;
  children?: (p: PageInfo) => ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // Only pages near the screen are drawn: a long document would otherwise hold a full-size
  // canvas for every page. The first two draw at once; without IntersectionObserver all do.
  const [near, setNear] = useState(page <= 2);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: `${DRAW_MARGIN_PX}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near) {
      // Out of range: give the canvas memory back. Its box (the CSS size) stays, so nothing moves.
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      return;
    }
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    (async () => {
      const p = await doc.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const scale = pageWidth(maxWidth) / base.width;
      const viewport = p.getViewport({ scale });
      const ratioPx = window.devicePixelRatio || 1;
      const c = canvasRef.current;
      if (!c || cancelled) return;
      c.width = Math.floor(viewport.width * ratioPx);
      c.height = Math.floor(viewport.height * ratioPx);
      setSize({ width: viewport.width, height: viewport.height });
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const render = p.render({ canvasContext: ctx, viewport, transform: ratioPx !== 1 ? [ratioPx, 0, 0, ratioPx, 0, 0] : undefined });
      task = render;
      try {
        await render.promise;
      } catch {
        // A cancelled render (the page re-laid out or scrolled away) is expected.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, maxWidth, near]);

  // The box is known before the page is drawn, so blocks on a far page already have a place
  // (and "scroll to this spot" can find them).
  const box = size ?? pageBox(maxWidth, ratio);

  return (
    <div data-page={page} ref={wrapRef} className="relative mx-auto mb-4 bg-white shadow-md" style={{ width: box.width, height: box.height }}>
      <canvas ref={canvasRef} className="block" style={{ width: box.width, height: box.height }} />
      {children ? <div className="absolute inset-0">{children({ page, ...box })}</div> : null}
    </div>
  );
}

export function PdfPages({
  src,
  onLoaded,
  children,
}: {
  /** URL of the PDF (cookies are sent, so authenticated routes work). */
  src: string;
  onLoaded?: (pageCount: number) => void;
  /** Draw on top of one page: absolutely positioned, using the page's percentages. */
  children?: (p: PageInfo) => ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(720);
  const [ratio, setRatio] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDoc | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const res = await fetch(src, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`Could not load the document (${res.status})`);
        const data = new Uint8Array(await res.arrayBuffer());
        const d = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          void d.destroy();
          return;
        }
        loaded = d;
        // The first page's shape sizes every page's box until it is drawn.
        const first = (await d.getPage(1)).getViewport({ scale: 1 });
        if (cancelled) return;
        setRatio(first.height / first.width);
        setDoc(d);
        onLoaded?.(d.numPages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the document");
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
    // onLoaded is a callback the parent may recreate; only the source should reload the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <div ref={wrapRef} className="w-full">
      {error ? (
        <p role="alert" className="rounded-lg border border-line bg-surface-1 p-4 text-sm text-status-danger">{error}</p>
      ) : !doc ? (
        <p className="p-6 text-center text-sm text-fg-muted">Loading the document…</p>
      ) : (
        Array.from({ length: doc.numPages }, (_, i) => (
          <PageCanvas key={i + 1} doc={doc} page={i + 1} maxWidth={width} ratio={ratio}>
            {children}
          </PageCanvas>
        ))
      )}
    </div>
  );
}
