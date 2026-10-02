"use client";

// Earn's proposals for this room: what is ready to publish, what is filed in
// the wrong section, and what is published but shouldn't be yet. Each applies
// with one click; nothing is applied on the operator's behalf.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { publishDocument, unpublishDocument } from "./room-actions";
import { refileDocument } from "@/components/documents/review-actions";
import type { OrganizerItem } from "@/lib/earn-room-organizer";

export function EarnRoomOrganizer({
  roomId,
  items,
  sectionLabels,
  canWrite,
}: {
  roomId: string;
  items: OrganizerItem[];
  sectionLabels: Record<string, string>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const remaining = items.filter((i) => !done.has(`${i.kind}:${i.docId}`));
  if (items.length === 0) return null;

  const apply = (items: OrganizerItem[]) =>
    startTransition(async () => {
      for (const item of items) {
        if (item.kind === "publish" || item.kind === "hold") {
          const fd = new FormData();
          fd.set("room_id", roomId);
          fd.set("document_id", item.docId);
          await (item.kind === "publish" ? publishDocument(fd) : unpublishDocument(fd));
        } else {
          await refileDocument(item.docId, item.to);
        }
        setDone((prev) => new Set(prev).add(`${item.kind}:${item.docId}`));
      }
      router.refresh();
    });

  const publishable = remaining.filter((i) => i.kind === "publish");
  const label = (k: string) => sectionLabels[k] ?? "Other Materials";

  return (
    <div className="mb-4 rounded-2xl border border-gold-500/25 bg-gold-500/5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">Earn</p>
        <p className="min-w-0 flex-1 text-sm text-fg-secondary">
          {remaining.length === 0
            ? "Room organized."
            : `${remaining.length} suggestion${remaining.length > 1 ? "s" : ""} to organize this room.`}
        </p>
        {remaining.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline"
          >
            {open ? "Hide" : "Review"}
          </button>
        ) : null}
      </div>

      {open && remaining.length > 0 ? (
        <>
          <ul className="mt-3 flex max-h-80 flex-col gap-1.5 overflow-y-auto">
            {remaining.map((item) => (
              <li
                key={`${item.kind}:${item.docId}`}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface-0 px-3 py-2 text-xs"
              >
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                    item.kind === "hold"
                      ? "border-amber-500/40 text-amber-300"
                      : item.kind === "refile"
                        ? "border-sky-500/40 text-sky-300"
                        : "border-emerald-500/40 text-emerald-300"
                  }`}
                >
                  {item.kind === "hold" ? "Withdraw" : item.kind === "refile" ? "Refile" : "Publish"}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/document/${item.docId}/review`} className="truncate text-fg-primary hover:text-gold-300">
                    {item.name}
                  </Link>
                  <p className="truncate text-fg-muted">
                    {item.kind === "refile" ? `${label(item.from)} → ${label(item.to)}. ` : ""}
                    {item.reason}
                  </p>
                </div>
                {canWrite ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => apply([item])}
                    className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline disabled:opacity-50"
                  >
                    Apply
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canWrite && publishable.length > 1 ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => apply(publishable)}
              className="mt-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline disabled:opacity-50"
            >
              {pending ? "Applying…" : `Publish all ${publishable.length} ready documents`}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
