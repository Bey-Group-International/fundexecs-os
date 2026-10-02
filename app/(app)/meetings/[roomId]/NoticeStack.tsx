"use client";

// The notices above the stage, one at a time.
//
// Eight different notices can sit over the video — the microphone is not
// working, the camera was refused, there is echo, you are a guest, the call is
// being recorded, a removal did not stick, the recording failed, the recording
// lost parts — and they used to stack, each a full-width bar. Three at once was
// a stage a third shorter, and the one that mattered was not always the one on
// top. Now the most urgent shows and the rest fold behind a count; the two that
// may never be folded (see `RoomNotice.pinned`) always show.
import { useState } from "react";
import { visibleNotices, type RoomNotice } from "@/lib/meetings/room-layout";

export interface StageNotice extends RoomNotice {
  node: React.ReactNode;
}

export function NoticeStack({ notices }: { notices: StageNotice[] }) {
  const [expanded, setExpanded] = useState(false);
  const { shown, hidden } = visibleNotices(notices, expanded);
  const unpinned = notices.filter((n) => !n.pinned).length;
  if (!shown.length) return null;

  return (
    <div className="shrink-0">
      {shown.map((n) => (
        <div key={n.id}>{n.node}</div>
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full px-4 py-1 text-left text-[11px] font-medium text-[var(--fg-muted)] bg-[var(--surface-1)] border-b border-[var(--line)] hover:text-[var(--fg-primary)] transition-colors"
        >
          {hidden} more notice{hidden === 1 ? "" : "s"}
        </button>
      ) : expanded && unpinned > 1 ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="w-full px-4 py-1 text-left text-[11px] font-medium text-[var(--fg-muted)] bg-[var(--surface-1)] border-b border-[var(--line)] hover:text-[var(--fg-primary)] transition-colors"
        >
          Show fewer
        </button>
      ) : null}
    </div>
  );
}
