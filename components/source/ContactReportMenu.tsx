"use client";

import { useEffect, useRef, useState } from "react";

// Download control for a contact's communications report — every inbox
// conversation and meeting linked to them, as one document
// (app/api/network/contacts/[id]/report). Plain anchors, like the meeting
// report's ExportMenu: the route sets Content-Disposition and the browser saves.

const FORMATS = [
  { format: "pdf", label: "PDF (.pdf)" },
  { format: "docx", label: "Word (.docx)" },
  { format: "md", label: "Markdown (.md)" },
  { format: "html", label: "HTML (.html)" },
] as const;

export function ContactReportMenu({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false);
  const [withMessages, setWithMessages] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const href = (format: string) =>
    `/api/network/contacts/${encodeURIComponent(contactId)}/report?format=${format}` +
    (withMessages ? "&messages=1" : "");

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:border-gold-400/40 hover:text-fg-primary"
      >
        Communications report
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-line bg-surface-1 p-2 text-left shadow-lg"
        >
          <p className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
            Every conversation and meeting
          </p>
          <div className="flex flex-col">
            {FORMATS.map(({ format, label }) => (
              <a
                key={format}
                role="menuitem"
                href={href(format)}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1.5 text-sm text-fg-primary transition-colors hover:bg-surface-2"
              >
                {label}
              </a>
            ))}
          </div>
          <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm text-fg-secondary transition-colors hover:bg-surface-2">
            <input
              type="checkbox"
              checked={withMessages}
              onChange={(e) => setWithMessages(e.target.checked)}
              className="mt-0.5 accent-gold-400"
            />
            <span>
              Include messages
              <span className="block text-[11px] text-fg-muted">
                Each conversation&apos;s recent messages, not only its summary.
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
