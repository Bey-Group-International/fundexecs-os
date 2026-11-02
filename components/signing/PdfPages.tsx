"use client";

// Renders a PDF page by page and lets the caller draw on top of each page. Positions
// are percentages of the page (from the top-left), so overlays stay put at any width.
// pdf.js is loaded in the browser only; the page is drawn to a canvas.
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface PageInfo {
  /** 1-based. */
  page: number;
  /** Rendered size in CSS pixels. */
  width: number;
  height: number;
}

type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;

function PageCanvas({ doc, page, maxWidth, children }: { doc: PdfDoc; page: number; maxWidth: number; children?: (p: PageInfo) => ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    (async () => {
      const p = await doc.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const scale = Math.min(maxWidth, 900) / base.width;
      const viewport = p.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      setSize({ width: viewport.width, height: viewport.height });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const render = p.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      task = render;
      try {
        await render.promise;
      } catch {
        // A cancelled render (the page re-laid out) is expected.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, maxWidth]);

  return (
    <div
      data-page={page}
      className="relative mx-auto mb-4 bg-white shadow-md"
      style={{ width: size?.width ?? maxWidth, height: size?.height ?? maxWidth * 1.294 }}
    >
      <canvas ref={canvasRef} className="block" style={{ width: size?.width, height: size?.height }} />
      {size && children ? <div className="absolute inset-0">{children({ page, ...size })}</div> : null}
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
          <PageCanvas key={i + 1} doc={doc} page={i + 1} maxWidth={width}>
            {children}
          </PageCanvas>
        ))
      )}
    </div>
  );
}
