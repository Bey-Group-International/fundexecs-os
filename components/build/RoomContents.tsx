"use client";

// What this room actually exposes. Every row here is a deliberate publish — the
// library holds far more — so the controls are about curation, not authoring:
// order a section, withdraw a document, or pull one in from the library. To
// change a document's text you go to Documents; this page never edits content.
import { useState, useTransition } from "react";
import Link from "next/link";
import { unpublishDocument, moveRoomDocument, publishDocument } from "./room-actions";
import type { DocumentStatus } from "@/lib/supabase/database.types";

export interface RoomContentDoc {
  id: string;
  name: string;
  status: DocumentStatus;
  /** False when the document has neither a link nor written content. */
  hasBody: boolean;
  isLink: boolean;
}

export interface RoomContentSection {
  key: string;
  label: string;
  docs: RoomContentDoc[];
}

/** A document in the library that is not yet in this room. */
export interface AvailableDoc {
  id: string;
  name: string;
  sectionLabel: string;
  status: DocumentStatus;
}

function Flag({ tone, children, title }: { tone: "amber" | "muted"; children: string; title: string }) {
  const cls =
    tone === "amber"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
      : "border-line bg-surface-0 text-fg-muted";
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${cls}`}
    >
      {children}
    </span>
  );
}

function DocRow({
  roomId,
  doc,
  hideReorder,
}: {
  roomId: string;
  doc: RoomContentDoc;
  hideReorder?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function act(fn: (fd: FormData) => Promise<void>, extra?: Record<string, string>) {
    const fd = new FormData();
    fd.set("room_id", roomId);
    fd.set("document_id", doc.id);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    startTransition(async () => {
      await fn(fd);
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-0 px-3 py-2">
      <span className="shrink-0 font-mono text-[11px] text-fg-muted">{doc.isLink ? "↗" : "≡"}</span>
      <Link
        href={`/document/${doc.id}`}
        className="min-w-0 flex-1 truncate text-sm text-fg-secondary transition hover:text-gold-300"
      >
        {doc.name}
      </Link>

      {/* Two things a GP wants caught before the link goes out. */}
      {doc.status !== "ready" ? (
        <Flag tone="amber" title="Published while still marked unfinished in your library — viewers can see it.">
          {doc.status === "draft" ? "Draft" : "In review"}
        </Flag>
      ) : null}
      {!doc.hasBody ? (
        <Flag tone="muted" title="No file link and no written content — this renders as an empty entry.">
          Empty
        </Flag>
      ) : null}

      {/* Reordering moves a document relative to its real neighbours in the
          room, which a filtered view is not showing — the arrows would appear
          to swap the wrong rows. Hidden while filtering, as "Publish from
          library" is, for the same reason. */}
      {hideReorder ? null : (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => act(moveRoomDocument, { dir: "up" })}
            title="Move up"
            className="rounded px-1.5 py-1 font-mono text-[11px] text-fg-muted transition hover:text-fg-primary disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => act(moveRoomDocument, { dir: "down" })}
            title="Move down"
            className="rounded px-1.5 py-1 font-mono text-[11px] text-fg-muted transition hover:text-fg-primary disabled:opacity-40"
          >
            ↓
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() => act(unpublishDocument)}
        title="Remove from this room — the document stays in your library"
        className="shrink-0 rounded-md border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:border-status-danger/40 hover:text-status-danger disabled:opacity-40"
      >
        Remove
      </button>
    </div>
  );
}

function AddFromLibrary({ roomId, available }: { roomId: string; available: AvailableDoc[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const matches = q
    ? available.filter(
        (d) => d.name.toLowerCase().includes(q) || d.sectionLabel.toLowerCase().includes(q),
      )
    : available;

  function add(id: string) {
    setAdded((prev) => [...prev, id]);
    const fd = new FormData();
    fd.set("room_id", roomId);
    fd.set("document_id", id);
    startTransition(async () => {
      await publishDocument(fd);
    });
  }

  if (available.length === 0) {
    return (
      <p className="mt-3 text-xs text-fg-muted">
        Everything in your library is already published here.{" "}
        <Link href="/build/documents" className="text-gold-300 hover:underline">
          Add more in Documents →
        </Link>
      </p>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
      >
        + Publish from library ({available.length})
      </button>

      {open ? (
        <div className="mt-2 rounded-xl border border-line bg-surface-0 p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your library…"
            className="mb-2 w-full rounded-md border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
          />
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {matches.length === 0 ? (
              <p className="px-1 py-2 text-xs text-fg-muted">No documents match.</p>
            ) : (
              matches.map((d) => {
                const done = added.includes(d.id);
                return (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-1"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary">{d.name}</span>
                    <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                      {d.sectionLabel}
                    </span>
                    {d.status !== "ready" ? (
                      <Flag tone="amber" title="Still marked unfinished in your library.">
                        {d.status === "draft" ? "Draft" : "In review"}
                      </Flag>
                    ) : null}
                    <button
                      type="button"
                      disabled={pending || done}
                      onClick={() => add(d.id)}
                      className="shrink-0 rounded-md border border-gold-500/40 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/10 disabled:opacity-40"
                    >
                      {done ? "Published" : "Publish"}
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <p className="mt-2 border-t border-line/60 pt-2 text-[11px] text-fg-muted">
            Documents are created and edited in{" "}
            <Link href="/build/documents" className="text-gold-300 hover:underline">
              Documents
            </Link>
            . Publishing only decides who can see them.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function RoomContents({
  roomId,
  sections,
  available,
  hideAddFromLibrary,
  hideReorder,
}: {
  roomId: string;
  sections: RoomContentSection[];
  available: AvailableDoc[];
  /** Suppressed while the pane is filtered — publishing into a partial view of
   * the room reads as publishing into the filter. */
  hideAddFromLibrary?: boolean;
  /** Suppressed while filtered — see DocRow. */
  hideReorder?: boolean;
}) {
  const count = sections.reduce((n, s) => n + s.docs.length, 0);

  return (
    <div>
      {count === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-0 px-4 py-6 text-center">
          <p className="text-sm text-fg-secondary">This room is empty.</p>
          <p className="mt-1 text-xs text-fg-muted">
            Nothing is shared until you publish it — that is what keeps drafts out of an LP&apos;s hands.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {sections.map((s) => (
            <div key={s.key}>
              <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                {s.label}
              </p>
              <div className="flex flex-col gap-1.5">
                {s.docs.map((d) => (
                  <DocRow key={d.id} roomId={roomId} doc={d} hideReorder={hideReorder} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {hideAddFromLibrary ? null : <AddFromLibrary roomId={roomId} available={available} />}
    </div>
  );
}
