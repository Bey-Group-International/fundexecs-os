"use client";

// The meeting to join now, under the lobby's toolbar.
//
// The lobby could start a meeting and join one by code, but the meeting most
// people open this page for — the one starting in five minutes, or the one
// their colleagues are already in — was a row somewhere in the list below, in
// whichever tab was open. This puts it in a line at the top with Join, and
// says nothing at all when the rest of the day is clear.
import Link from "next/link";
import { meetingTimeState } from "@/lib/meetings/schedule";
import type { UpNext } from "@/lib/meetings/lobby";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";

export function UpNextStrip({ next, now }: { next: UpNext<UpcomingMeeting> | null; now: number }) {
  if (!next) return null;
  const { meeting, live, inRoom } = next;
  const ts = meetingTimeState(meeting.scheduled_at, meeting.duration_minutes, now);
  const at = meeting.scheduled_at
    ? new Date(meeting.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const who =
    inRoom.count > 0
      ? `${inRoom.count} in the room${inRoom.names.length ? ` · ${inRoom.names.slice(0, 3).join(", ")}${inRoom.names.length > 3 ? ` +${inRoom.names.length - 3}` : ""}` : ""}`
      : null;
  const when = live
    ? ts?.phase === "in_progress" ? `Started ${at ?? ""} · ${ts.label}` : "Live now"
    : `${at ?? ""}${ts ? ` · ${ts.label}` : ""}`;

  return (
    <section
      aria-label={live ? "Live now" : "Up next"}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 sm:flex-nowrap ${
        live ? "border-status-success/40 bg-status-success/5" : "border-line bg-surface-1"
      }`}
    >
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${
          live ? "bg-status-success/15 text-[var(--status-success)]" : "bg-surface-3 text-fg-secondary"
        }`}
      >
        {live ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> : null}
        {live ? "Live" : "Up next"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg-primary">{meeting.title}</p>
        <p className="truncate text-xs text-fg-muted">
          {when}
          {who ? ` · ${who}` : ""}
        </p>
      </div>
      <Link
        href={`/meetings/${meeting.room_code}`}
        className={`fx-btn inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:min-h-9 sm:w-auto ${
          live ? "bg-[var(--status-success)]" : "bg-gold-400"
        }`}
      >
        {live ? "Join now" : "Join"}
      </Link>
    </section>
  );
}
