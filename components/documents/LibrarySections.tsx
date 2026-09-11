"use client";

// The library: every document the firm holds, filed by section, drafts
// included. Authoring lives here — create, draft with AI, set status, delete —
// and so does the one control that connects the two halves of the split:
// publishing a document into a data room.
import { useState, useTransition } from "react";
import Link from "next/link";
import { addDocument, newDocument, updateDocumentStatus } from "./document-actions";
import { publishDocument, unpublishDocument } from "@/components/build/room-actions";
import { DeleteDocumentButton } from "@/components/build/DeleteDocumentButton";
import { GenerateAiButton } from "@/components/build/GenerateAiButton";
import type { DocumentStatus } from "@/lib/supabase/database.types";

export interface LibraryRoom {
  id: string;
  name: string;
}

export interface LibraryDoc {
  id: string;
  name: string;
  storage_key: string | null;
  status: DocumentStatus;
  qualityScore: number | null;
  qualityLevel: string | null;
  qualityGaps: number | null;
  /** Ids of the rooms this document is published into. */
  roomIds: string[];
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

function StatusCycler({ doc }: { doc: LibraryDoc }) {
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
function PublishControl({ doc, rooms }: { doc: LibraryDoc; rooms: LibraryRoom[] }) {
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

function QualityBadges({ doc }: { doc: LibraryDoc }) {
  return (
    <>
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
    </>
  );
}

function SectionRow({ section, rooms }: { section: LibrarySection; rooms: LibraryRoom[] }) {
  const [open, setOpen] = useState(section.docs.length > 0);
  const [linking, setLinking] = useState(false);
  const [pending, startTransition] = useTransition();

  const sharedCount = section.docs.filter((d) => d.roomIds.length > 0).length;

  return (
    <div
      id={`section-${section.key}`}
      className="scroll-mt-24 overflow-hidden rounded-xl border border-line bg-surface-0 transition-all duration-200"
      style={{ boxShadow: open ? "0 2px 8px rgba(0,0,0,0.18)" : undefined }}
    >
      <div className="flex w-full items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          <span
            className="shrink-0 font-mono text-xs transition-transform duration-200"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            <span className="text-fg-muted">›</span>
          </span>
          <span className="truncate text-sm font-medium text-fg-primary">{section.label}</span>
          {section.viaBuild && section.docs.length === 0 ? (
            <span className="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-sky-400">
              From Build
            </span>
          ) : null}
        </button>

        <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          {section.docs.length === 0
            ? "Empty"
            : `${section.docs.length} doc${section.docs.length > 1 ? "s" : ""}${sharedCount > 0 ? ` · ${sharedCount} shared` : ""}`}
        </span>

        <div className="flex shrink-0 items-center gap-1.5">
          {section.aiDraftable && section.docs.length === 0 ? (
            <GenerateAiButton sectionKey={section.key} />
          ) : null}
          <button
            type="button"
            onClick={() => setLinking((v) => !v)}
            title="File a document that lives elsewhere — Drive, Dropbox, a signed PDF"
            className="rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300"
          >
            + Link
          </button>
          <form action={(fd) => startTransition(async () => { await newDocument(fd); })}>
            <input type="hidden" name="section" value={section.key} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
            >
              {pending ? "…" : "+ New"}
            </button>
          </form>
        </div>
      </div>

      {linking ? (
        <form
          action={(fd) =>
            startTransition(async () => {
              await addDocument(fd);
              setLinking(false);
              setOpen(true);
            })
          }
          className="flex flex-wrap items-center gap-2 border-t border-line/50 bg-surface-1 px-4 py-3"
        >
          <input type="hidden" name="section" value={section.key} />
          <input
            name="name"
            required
            placeholder="Document name"
            className="min-w-[10rem] flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
          />
          <input
            name="url"
            type="url"
            required
            placeholder="https://…"
            className="min-w-[12rem] flex-[2] rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
          >
            {pending ? "Adding…" : "Add link"}
          </button>
        </form>
      ) : null}

      {open ? (
        <div className="border-t border-line/50 bg-surface-1 px-4 py-3">
          {section.docs.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {section.docs.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-0 px-3 py-2"
                >
                  <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                    {d.storage_key ? "↗" : "≡"}
                  </span>
                  <Link
                    href={`/document/${d.id}`}
                    className="min-w-0 flex-1 truncate text-sm text-fg-secondary transition hover:text-gold-300"
                  >
                    {d.name}
                  </Link>
                  <QualityBadges doc={d} />
                  <StatusCycler doc={d} />
                  <PublishControl doc={d} rooms={rooms} />
                  <DeleteDocumentButton id={d.id} name={d.name} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-fg-muted">
              {section.viaBuild
                ? "Covered by your Build foundation — add a document here when you want a written version LPs can read."
                : section.description}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function LibrarySections({
  sections,
  rooms,
}: {
  sections: LibrarySection[];
  rooms: LibraryRoom[];
}) {
  return (
    <div className="flex flex-col gap-2">
      {sections.map((s) => (
        <SectionRow key={s.key} section={s} rooms={rooms} />
      ))}
    </div>
  );
}
