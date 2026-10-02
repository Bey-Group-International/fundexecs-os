"use client";

// A document shown as-is, inside the page.
//
// Used in two places that must agree: the GP's review page (the file beside
// Earn's read of it) and the LP data room viewer (where a view-only link has no
// other way to read anything). PDFs, images and video render natively from a
// same-origin URL; Word, Excel and PowerPoint render from the structured
// preview extracted server-side — no third-party viewer ever receives the file.
import { useEffect, useRef, useState } from "react";
import type { PreviewKind } from "@/lib/document-files";
import type { OfficePreview } from "@/lib/ooxml";

interface PreviewPayload {
  status: "ok" | "empty" | "unsupported" | "failed";
  preview: OfficePreview | null;
  text: string | null;
}

export function FilePreview({
  kind,
  src,
  previewUrl,
  name,
  viewOnly = false,
  overlayLabel,
  className = "",
}: {
  kind: PreviewKind;
  /** Same-origin URL of the file's bytes (inline). */
  src: string;
  /** Same-origin URL of the structured preview JSON, for office/text kinds. */
  previewUrl: string;
  name: string;
  /** Hide native download affordances where the browser allows it. */
  viewOnly?: boolean;
  /** Tiled deterrent label drawn over non-PDF previews (PDFs are stamped server-side). */
  overlayLabel?: string | null;
  className?: string;
}) {
  const frame = `relative overflow-hidden rounded-xl border border-line bg-surface-0 ${className}`;

  if (kind === "pdf") {
    return (
      <PdfFrame
        className={frame}
        title={name}
        // #toolbar=0 hides the download/print bar in Chromium's viewer.
        src={viewOnly ? `${src}#toolbar=0&navpanes=0` : src}
      />
    );
  }

  if (kind === "image") {
    return (
      <div className={frame} onContextMenu={viewOnly ? (e) => e.preventDefault() : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name}
          draggable={!viewOnly}
          className="mx-auto block max-h-[min(80dvh,56rem)] w-auto max-w-full object-contain"
        />
        <Overlay label={overlayLabel} />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className={frame}>
        <video
          src={src}
          controls
          preload="metadata"
          controlsList={viewOnly ? "nodownload" : undefined}
          onContextMenu={viewOnly ? (e) => e.preventDefault() : undefined}
          className="block max-h-[min(80dvh,56rem)] w-full bg-black"
        />
        <Overlay label={overlayLabel} />
      </div>
    );
  }

  if (kind === "office" || kind === "text") {
    return (
      <div className={frame} onContextMenu={viewOnly ? (e) => e.preventDefault() : undefined}>
        <StructuredPreview url={previewUrl} viewOnly={viewOnly} />
        <Overlay label={overlayLabel} />
      </div>
    );
  }

  return (
    <div className={`${frame} px-5 py-8 text-center`}>
      <p className="text-sm text-fg-secondary">No in-app preview for this file type.</p>
      <p className="mt-1 text-xs text-fg-muted">
        {viewOnly ? "Ask the sender for a copy." : "Open or download it to read it."}
      </p>
    </div>
  );
}

// The browser's PDF viewer takes every wheel turned over it, so a tall preview
// stopped the page dead whenever the cursor crossed it. Until the reader clicks
// in, a shield lets the wheel scroll the page past it; once clicked, the PDF
// has the wheel until the cursor (or a tap elsewhere) leaves it.
function PdfFrame({ className, title, src }: { className: string; title: string; src: string }) {
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!active) return;
    // Activation removes the button that had focus; put focus where the reader
    // asked to go, or a keyboard user is dropped back to the top of the page.
    frameRef.current?.focus();
    // Touch has no mouseleave: a tap outside hands the wheel back.
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setActive(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [active]);

  return (
    <div ref={ref} className={`group ${className}`} onMouseLeave={() => setActive(false)}>
      <iframe
        ref={frameRef}
        title={title}
        src={src}
        // Out of the tab order until activated, so Tab reaches the shield
        // first rather than slipping into the PDF behind it.
        tabIndex={active ? 0 : -1}
        className="block h-[min(80dvh,56rem)] w-full bg-white"
      />
      {active ? null : (
        <button
          type="button"
          onClick={() => setActive(true)}
          aria-label={`Scroll inside ${title}`}
          className="absolute inset-0 flex cursor-default items-end justify-center bg-transparent pb-4 focus:outline-none"
        >
          <span className="rounded-full border border-line bg-surface-0/90 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-fg-secondary opacity-0 shadow transition group-hover:opacity-100 group-focus-within:opacity-100">
            Click to scroll the document
          </span>
        </button>
      )}
    </div>
  );
}

function Overlay({ label }: { label?: string | null }) {
  if (!label) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex flex-col justify-around overflow-hidden"
    >
      {[0, 1, 2, 3].map((i) => (
        <p
          key={i}
          className="-rotate-[20deg] whitespace-nowrap text-center font-mono text-sm text-fg-primary/10"
        >
          {label} · {label}
        </p>
      ))}
    </div>
  );
}

function StructuredPreview({ url, viewOnly }: { url: string; viewOnly: boolean }) {
  const [state, setState] = useState<
    { phase: "loading" } | { phase: "ready"; data: PreviewPayload } | { phase: "error" }
  >({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<PreviewPayload>) : Promise.reject(r.status)))
      .then((data) => {
        if (!cancelled) setState({ phase: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.phase === "loading") {
    return (
      <div className="px-5 py-10 text-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">Preparing preview…</p>
      </div>
    );
  }
  if (state.phase === "error" || state.data.status === "failed" || state.data.status === "unsupported") {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm text-fg-secondary">A preview isn&apos;t available for this file.</p>
        <p className="mt-1 text-xs text-fg-muted">
          {viewOnly
            ? "Ask the sender for a copy."
            : "Older .doc, .xls and .ppt files, and very large files, can only be opened or downloaded."}
        </p>
      </div>
    );
  }

  const { preview, text } = state.data;
  if (!preview) {
    return (
      <pre className="max-h-[min(80dvh,56rem)] overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-xs leading-relaxed text-fg-secondary">
        {text || "This file is empty."}
      </pre>
    );
  }
  if (preview.kind === "docx") return <DocxView preview={preview} />;
  if (preview.kind === "xlsx") return <XlsxView preview={preview} />;
  return <PptxView preview={preview} />;
}

function DocxView({ preview }: { preview: Extract<OfficePreview, { kind: "docx" }> }) {
  if (preview.blocks.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-fg-muted">This document has no text.</p>;
  }
  return (
    <article className="mx-auto max-h-[min(80dvh,56rem)] max-w-3xl overflow-y-auto px-6 py-6 text-sm leading-relaxed text-fg-secondary">
      {preview.blocks.map((b, i) =>
        b.style === "h1" ? (
          <h2 key={i} className="mb-2 mt-5 font-display text-lg font-semibold text-fg-primary first:mt-0">
            {b.text}
          </h2>
        ) : b.style === "h2" ? (
          <h3 key={i} className="mb-1.5 mt-4 font-display text-base font-semibold text-fg-primary">
            {b.text}
          </h3>
        ) : b.style === "h3" ? (
          <h4 key={i} className="mb-1 mt-3 text-sm font-semibold text-fg-primary">
            {b.text}
          </h4>
        ) : b.style === "li" ? (
          <p key={i} className="mb-1 pl-4 before:-ml-3 before:mr-1.5 before:content-['•']">
            {b.text}
          </p>
        ) : (
          <p key={i} className="mb-2.5 whitespace-pre-wrap">
            {b.text}
          </p>
        ),
      )}
    </article>
  );
}

function XlsxView({ preview }: { preview: Extract<OfficePreview, { kind: "xlsx" }> }) {
  const [active, setActive] = useState(0);
  const sheet = preview.sheets[active];
  if (!sheet) return <p className="px-5 py-10 text-center text-sm text-fg-muted">This workbook is empty.</p>;
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  return (
    <div>
      {preview.sheets.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line px-2 pt-2">
          {preview.sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              type="button"
              onClick={() => setActive(i)}
              aria-pressed={i === active}
              className={`shrink-0 rounded-t-lg px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ${
                i === active ? "bg-surface-1 text-fg-primary" : "text-fg-muted hover:text-fg-secondary"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="max-h-[min(75dvh,52rem)] overflow-auto">
        <table className="min-w-full border-collapse font-mono text-[11px] text-fg-secondary">
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r} className="border-b border-line/40">
                <th className="sticky left-0 bg-surface-1 px-2 py-1 text-right font-normal text-fg-muted">{r + 1}</th>
                {Array.from({ length: width }, (_, c) => (
                  <td key={c} className="whitespace-nowrap border-l border-line/30 px-2 py-1">
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.truncated ? (
        <p className="border-t border-line px-3 py-2 font-mono text-[11px] text-fg-muted">
          Preview shows the first rows and columns. The full workbook is in the file.
        </p>
      ) : null}
    </div>
  );
}

function PptxView({ preview }: { preview: Extract<OfficePreview, { kind: "pptx" }> }) {
  if (preview.slides.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-fg-muted">This deck has no slides.</p>;
  }
  return (
    <ol className="grid max-h-[min(80dvh,56rem)] gap-3 overflow-y-auto p-4 sm:grid-cols-2">
      {preview.slides.map((s, i) => (
        <li key={i} className="flex aspect-video flex-col overflow-hidden rounded-lg border border-line bg-surface-1 p-4">
          <p className="font-mono text-[11px] text-fg-muted">Slide {i + 1}</p>
          {s.title ? <p className="mt-1 font-display text-sm font-semibold text-fg-primary">{s.title}</p> : null}
          <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-hidden text-xs text-fg-secondary">
            {s.lines.slice(0, 8).map((l, j) => (
              <li key={j} className="truncate">
                {l}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
