"use client";

// A meeting's preview, beside the list.
//
// The old list expanded a row in place: the details pushed every meeting below
// it down the page, only one could be open, and opening another lost your place.
// The preview opens on the right on a wide screen — the list stays where it was,
// and moving down it changes what the panel shows — and as a sheet over the page
// on a narrow one. Everything that could be done from the expanded row is here.
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { EXTERNAL_SYNC_STATUS_LABELS, type ExternalSyncStatus, type MeetingDisplayStatus } from "@/lib/meetings/schedule";
import { seriesPositionLabel } from "@/lib/meetings/recurrence";
import { initialsOf, rowChips } from "@/lib/meetings/workspace";
import { STATUS_TONE, chip } from "./tone";
import {
  ActionButton,
  ConfirmBox,
  MeetingDetails,
  copilotName,
  formatScheduled,
  notifiableGuestCount,
} from "./meeting-shared";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";
import type { ReminderOutcome } from "./useUpcomingMeetings";

export function MeetingPreview({
  meeting,
  status,
  ended,
  live,
  room,
  reminder,
  busy,
  confirmingDelete,
  onClose,
  onPrep,
  onFollowUp,
  onEdit,
  onRemind,
  onRetrySync,
  onRemoveFromCalendar,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  meeting: UpcomingMeeting;
  status: MeetingDisplayStatus;
  ended: boolean;
  live: boolean;
  room: { count: number; names: string[] } | null;
  reminder: ReminderOutcome | null;
  busy: boolean;
  confirmingDelete: boolean;
  onClose: () => void;
  onPrep: () => void;
  onFollowUp: () => void;
  onEdit: () => void;
  onRemind: () => void;
  onRetrySync: () => void;
  onRemoveFromCalendar: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: (scope: "one" | "following") => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // A trap only where the panel covers the page: on a wide screen it sits
  // beside the list, and trapping focus there would make the list unreachable.
  const narrow = typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches;
  useFocusTrap(panel, Boolean(narrow));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rawSync = meeting.external_calendar_sync_status;
  const syncStatus: ExternalSyncStatus =
    rawSync && rawSync in EXTERNAL_SYNC_STATUS_LABELS ? (rawSync as ExternalSyncStatus) : "not_connected";
  const copilot = copilotName(meeting.assigned_copilot_agent);
  const series = seriesPositionLabel(meeting.series_rule, meeting.series_index);
  const guests = notifiableGuestCount(meeting);

  return (
    <>
      {/* The page behind a narrow-screen sheet. */}
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] lg:hidden"
      />
      <aside
        ref={panel}
        role="dialog"
        aria-label={`${meeting.title} preview`}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col overflow-hidden rounded-t-2xl border border-line bg-surface-1 shadow-2xl lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:max-h-[calc(100vh-2rem)] lg:rounded-2xl lg:shadow-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="break-words font-display text-base font-semibold text-fg-primary">{meeting.title}</h2>
            <p className="mt-0.5 text-xs capitalize text-fg-secondary">
              {(meeting.meeting_type ?? "meeting").replace(/_/g, " ")}
              {" · "}
              {meeting.scheduled_at ? formatScheduled(meeting.scheduled_at) : "Time TBD"}
              {meeting.duration_minutes ? ` · ${meeting.duration_minutes} min` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="fx-btn shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg-primary"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={chip(STATUS_TONE[status])}>{status}</span>
            {meeting.preparation_status === "ready" ? <span className={chip("success")}>Prep ready</span> : null}
            {rowChips(meeting).map((c) => (
              <span key={c.label} className={chip(c.tone)}>
                {c.label}
              </span>
            ))}
            {room && room.count > 0 ? (
              <span className={chip("success")}>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                {room.count} in the room
              </span>
            ) : null}
          </div>

          {(meeting.attendees?.length ?? 0) > 0 ? (
            <div className="mt-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-fg-muted">
                People · {meeting.attendees!.length}
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {meeting.attendees!.map((a, i) => (
                  <li key={`${a.email ?? a.name}-${i}`} className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-fg-secondary"
                    >
                      {initialsOf(a.name || a.email)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-fg-primary">{a.name || a.email}</span>
                      <span className="block truncate text-[11px] text-fg-muted">
                        {a.type === "internal" ? "Internal" : "External"}
                        {a.email && a.name ? ` · ${a.email}` : ""}
                        {!a.email ? " · no email" : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-muted">
            {[
              copilot ? `copilot: ${copilot}` : null,
              `calendar: ${EXTERNAL_SYNC_STATUS_LABELS[syncStatus]}`,
              series?.toLowerCase() ?? null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          <MeetingDetails meeting={meeting} />

          {reminder?.message ? (
            <p
              role="status"
              className={`mt-3 text-xs ${reminder.state === "sent" ? "text-[var(--status-success)]" : "text-[var(--status-warning)]"}`}
            >
              {reminder.message}
            </p>
          ) : null}

          {confirmingDelete ? (
            <ConfirmBox
              title={meeting.series_id ? "Delete a repeating meeting?" : "Delete this meeting?"}
              body={
                guests > 0
                  ? `This deletes the local FundExecs meeting record only. Connected calendar events are not deleted unless separately approved and synced. ${guests} guest${guests === 1 ? "" : "s"} will be emailed that it's cancelled.`
                  : "This deletes the local FundExecs meeting record only. Connected calendar events are not deleted unless separately approved and synced."
              }
              confirmLabel={busy ? "Deleting..." : meeting.series_id ? "Delete this meeting" : "Delete from FundExecs only"}
              onConfirm={() => onDelete("one")}
              alsoLabel={meeting.series_id && !busy ? "This and following meetings" : undefined}
              onAlso={() => onDelete("following")}
              onCancel={onCancelDelete}
            />
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-3">
          {ended ? (
            <Link
              href={`/meetings/${meeting.room_code}/report`}
              className="fx-btn rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-[#0d0d10] hover:opacity-90"
            >
              Open report
            </Link>
          ) : (
            <Link
              href={`/meetings/${meeting.room_code}`}
              className={`fx-btn rounded-lg px-3 py-1.5 text-xs font-semibold ${
                live ? "bg-[var(--status-success)] text-white" : "bg-[var(--gold-400)] text-[#0d0d10]"
              } hover:opacity-90`}
            >
              {live ? "Join live" : "Join"}
            </Link>
          )}
          <ActionButton onClick={ended ? onFollowUp : onPrep}>{ended ? "Follow up" : "Prepare with Earn"}</ActionButton>
          <ActionButton onClick={onEdit}>Edit or reschedule</ActionButton>
          {!ended ? (
            <ActionButton disabled={busy || reminder?.state === "sending"} onClick={onRemind}>
              {reminder?.state === "sending" ? "Sending…" : "Send reminder"}
            </ActionButton>
          ) : null}
          {syncStatus === "sync_failed" || syncStatus === "needs_resync" ? (
            <ActionButton disabled={busy} onClick={onRetrySync}>
              Retry sync
            </ActionButton>
          ) : null}
          {meeting.external_calendar_sync_enabled ? (
            <ActionButton disabled={busy} onClick={onRemoveFromCalendar}>
              Remove from calendar
            </ActionButton>
          ) : null}
          <ActionButton danger onClick={onAskDelete}>
            Delete
          </ActionButton>
        </footer>
      </aside>
    </>
  );
}
