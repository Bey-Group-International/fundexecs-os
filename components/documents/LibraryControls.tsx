"use client";

// The per-document controls the library row carries, and the shape the server
// hands down. Split out from the workspace so the table stays readable: the
// workspace decides what is shown, these decide what each control does.
import { useState, useTransition } from "react";
import { updateDocumentStatus } from "./document-actions";
import { publishDocument, unpublishDocument } from "@/components/build/room-actions";
import type { DocumentStatus } from "@/lib/supabase/database.types";

export interface LibraryRoom {
  id: string;
  name: string;
}

export interface LibraryDoc {
  id: string;
  name: string;
  /** External URL, bucket object path, or null. */
  storageKey: string | null;
  /** Whether the document has written content of its own. */
  hasContent: boolean;
  /** "PDF" | "Excel" | "Link" | "Written" | "Empty" … */
  kind: string;
  sizeBytes: number | null;
  /** True when the file lives in our bucket rather than someone else's URL. */
  uploaded: boolean;
  status: DocumentStatus;
  qualityScore: number | null;
  qualityLevel: string | null;
  qualityGaps: number | null;
  /** Ids of the rooms this document is published into. */
  roomIds: string[];
  /** Section (doc_type) the document is filed under. */
  section: string;
  /** ISO timestamp, for sorting. */
  updatedAt: string;
  /** Relative label rendered as-is. Computed on the server: computing it during
   * a client render would disagree with the server's HTML and trip hydration. */
  updatedLabel: string;
}

export interface LibrarySection {
  key: string;
  label: string;
  description: string;
  docs: LibraryDoc[];
  /** True when Build data already covers this section even with no document. */
  viaBuild: boolean;
  /** Sections Earn can draft from the firm's Build foundation. */
  aiDraftable: boolean;
}

const STATUS_CYCLE: DocumentStatus[] = ["draft", "review", "ready"];
const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: "Draft",
  review: "Review",
  ready: "Ready",
};
const STATUS_CLASSES: Record<DocumentStatus, string> = {
  draft: "bg-surface-0 border border-line text-fg-muted",
  review: "bg-amber-500/10 border border-amber-500/30 text-amber-400",
  ready: "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400",
};

export function StatusCycler({ doc }: { doc: LibraryDoc }) {
  const [status, setStatus] = useState<DocumentStatus>(doc.status);
  const [pending, startTransition] = useTransition();

  function cycle() {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(status) + 1) % STATUS_CYCLE.length];
    setStatus(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", doc.id);
      fd.set("status", next);
      await updateDocumentStatus(fd);
    });
  }

  return (
    <button
      type="button"
      onClick={cycle}
      disabled={pending}
      title={`Status: ${STATUS_LABELS[status]} — click to advance. Status is internal; it never publishes anything.`}
      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider transition hover:opacity-80 disabled:opacity-50 ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </button>
  );
}

/**
 * Publishing is the only way a document reaches an outside reader, so it is an
 * explicit, per-room toggle rather than a side effect of status. The pill shows
 * at a glance whether anything outside the firm can see this document.
 */
export function PublishControl({ doc, rooms }: { doc: LibraryDoc; rooms: LibraryRoom[] }) {
  const [open, setOpen] = useState(false);
  const [published, setPublished] = useState<string[]>(doc.roomIds);
  const [pending, startTransition] = useTransition();

  if (rooms.length === 0) return null;

  function toggle(roomId: string) {
    const isOn = published.includes(roomId);
    setPublished((prev) => (isOn ? prev.filter((r) => r !== roomId) : [...prev, roomId]));
    startTransition(async () => {
      const fd = new FormData();
      fd.set("room_id", roomId);
      fd.set("document_id", doc.id);
      await (isOn ? unpublishDocument(fd) : publishDocument(fd));
    });
  }

  const count = published.length;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-expanded={open}
        title={count > 0 ? `Published to ${count} room${count > 1 ? "s" : ""}` : "Private to your firm"}
        className={`rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider transition hover:opacity-80 disabled:opacity-50 ${
          count > 0
            ? "border border-gold-500/40 bg-gold-500/10 text-gold-300"
            : "border border-line bg-surface-0 text-fg-muted"
        }`}
      >
        {count > 0 ? `Shared · ${count}` : "Private"}
      </button>

      {open ? (
        <>
          {/* Click-away layer — keeps the popover from stealing the page. */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 z-50 mt-1.5 w-60 rounded-xl border border-line bg-surface-0 p-2 shadow-xl">
            <p className="px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              Publish to
            </p>
            {rooms.map((r) => {
              const on = published.includes(r.id);
              return (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-fg-secondary hover:bg-surface-1"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(r.id)}
                    className="h-3.5 w-3.5 accent-gold-400"
                  />
                  <span className="truncate">{r.name}</span>
                </label>
              );
            })}
            <p className="mt-1 border-t border-line/60 px-2 pt-2 text-[11px] leading-snug text-fg-muted">
              Only published documents are reachable from a share link.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function QualityBadges({ doc }: { doc: LibraryDoc }) {
  if (!doc.qualityLevel && doc.qualityScore == null) {
    return <span className="font-mono text-[11px] text-fg-muted">—</span>;
  }
  return (
    <span className="flex items-center gap-1.5">
      {doc.qualityLevel ? (
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
            doc.qualityLevel === "Institutional"
              ? "border-emerald-400/40 text-emerald-300"
              : doc.qualityLevel === "Solid"
                ? "border-gold-500/40 text-gold-300"
                : "border-line text-fg-muted"
          }`}
        >
          {doc.qualityLevel}
        </span>
      ) : null}
      {doc.qualityScore != null ? (
        <span className="shrink-0 font-mono text-[11px] text-fg-muted">{doc.qualityScore}%</span>
      ) : null}
      {doc.qualityScore != null && doc.qualityScore < 80 && doc.qualityGaps ? (
        <span
          title={`${doc.qualityGaps} quality gap${doc.qualityGaps > 1 ? "s" : ""} remaining`}
          className="flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-amber-500/15 px-1 font-mono text-[11px] text-amber-400"
        >
          {doc.qualityGaps}
        </span>
      ) : null}
    </span>
  );
}
