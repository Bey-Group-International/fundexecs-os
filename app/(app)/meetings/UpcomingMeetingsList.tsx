"use client";

import { memo, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  deriveMeetingStatus,
  meetingTimeState,
  EXTERNAL_SYNC_STATUS_LABELS,
  type ExternalSyncStatus,
  type MeetingDisplayStatus,
  type MeetingTimePhase,
} from "@/lib/meetings/schedule";
import { CARD, COUNTDOWN_TONE, EYEBROW, STATUS_TONE, chip } from "./tone";
import {
  ActionButton,
  ConfirmBox,
  MeetingDetails,
  MeetingEditScreen,
  OverflowMenu,
  copilotName,
  formatScheduled,
  formatScheduledShort,
  notifiableGuestCount,
  toEditInitial,
} from "./meeting-shared";
import { useNow, useLivePresence } from "./hooks";
import { useUpcomingMeetings } from "./useUpcomingMeetings";
import { seriesPositionLabel } from "@/lib/meetings/recurrence";

/** How often the list re-reads the clock. */
const CLOCK_TICK_MS = 15_000;

/**
 * The one row every upcoming meeting always shows.
 *
 * Memoised, and on PRIMITIVES rather than the meeting, because a clock drives
 * this list: `useNow` re-renders the whole view every fifteen seconds so the
 * countdowns stay right. Measured over ten minutes of ticks against the real
 * `meetingTimeState` and `deriveMeetingStatus`, 93% of those row re-renders
 * changed nothing on screen — a meeting three weeks out reads "in 22 days"
 * either side of a tick. At sixty meetings the tick cost 64.58ms of React work
 * where a memoised row costs 2.83ms, and 64ms every fifteen seconds is a
 * stutter somebody can see.
 *
 * So the derivation stays in the parent, where it is cheap arithmetic over the
 * new clock, and what reaches the row is the handful of strings it draws. A row
 * whose text the tick did not change does not re-render at all.
 *
 * The EXPANDED panel is deliberately not in here. Only one row is ever open, so
 * it costs one render rather than N, and it closes over every handler on the
 * list; moving it would be a large change for no measured gain.
 */
const CollapsedRow = memo(function CollapsedRow({
  id,
  roomCode,
  title,
  scheduledAt,
  isOpen,
  live,
  phase,
  countdown,
  status,
  compact,
  onToggle,
}: {
  id: string;
  roomCode: string;
  title: string;
  scheduledAt: string | null;
  isOpen: boolean;
  live: boolean;
  phase: MeetingTimePhase | null;
  countdown: string | null;
  status: MeetingDisplayStatus;
  compact: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 pr-2">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
        aria-controls={`meeting-panel-${id}`}
        className="fx-focus flex min-w-0 flex-1 items-center gap-2.5 rounded-l-2xl px-3 py-2.5 text-left transition-colors hover:bg-surface-2/70"
      >
        <span
          aria-hidden
          className={`shrink-0 text-fg-muted transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
        >
          <ChevronIcon />
        </span>
        {!compact ? (
          <span className="hidden w-[124px] shrink-0 font-mono text-[11px] tabular-nums uppercase tracking-[0.06em] text-fg-secondary sm:block">
            {scheduledAt ? formatScheduledShort(scheduledAt) : "Time TBD"}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary">
          {title}
        </span>
        {phase && phase !== "ended" ? (
          <span className={`${chip(COUNTDOWN_TONE[phase])} hidden sm:inline-flex`}>
            {phase === "imminent" || phase === "in_progress" ? (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            ) : null}
            {phase === "in_progress" ? "In progress" : countdown}
          </span>
        ) : null}
        <span className={chip(STATUS_TONE[status])}>{status}</span>
      </button>
      <Link
        href={`/meetings/${roomCode}`}
        className={`fx-btn shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
          live
            ? "bg-[var(--status-success)] text-white hover:opacity-90"
            : "border border-gold-400/35 bg-gold-400/10 text-[var(--gold-300)] hover:bg-gold-400/20"
        }`}
      >
        {live ? "Join live" : "Join"}
      </Link>
    </div>
  );
});

export interface UpcomingMeeting {
  id: string;
  room_code: string;
  title: string;
  description: string | null;
  location: string | null;
  meeting_url: string | null;
  status: "waiting" | "active" | "ended";
  scheduled_at: string | null;
  duration_minutes: number | null;
  timezone: string | null;
  meeting_type: string | null;
  priority: "low" | "normal" | "high" | "critical" | null;
  tags: string[] | null;
  attendees: Array<{ name: string; email?: string; type?: "internal" | "external" }> | null;
  source: string | null;
  sync_status: string | null;
  source_event_id: string | null;
  source_calendar_id: string | null;
  deal_id: string | null;
  related_contact_id: string | null;
  related_fund_id: string | null;
  objective: string | null;
  agenda: string | null;
  preparation_requirements: string | null;
  preparation_status: string | null;
  followup_status: string | null;
  assigned_copilot_agent: string | null;
  related_record_type: string | null;
  related_record_id: string | null;
  calendar_visibility: string | null;
  reminder_minutes: number | null;
  external_calendar_provider: string | null;
  external_calendar_sync_enabled: boolean | null;
  external_calendar_sync_status: string | null;
  is_draft: boolean | null;
  locked_at: string | null;
  updated_at: string | null;
  guest_quick_access: boolean | null;
  /** Set on every meeting of a repeating series. */
  series_id?: string | null;
  series_index?: number | null;
  series_rule?: string | null;
}

export function UpcomingMeetingsList({
  initialMeetings,
  compact = false,
  reuseRecent = false,
}: {
  initialMeetings: UpcomingMeeting[];
  /** Rail variant: drop the row's time column so it fits a narrow sidebar. */
  compact?: boolean;
  /**
   * Start from another copy's answer when it is only seconds old, instead of
   * fetching the same list again. For the calendar's rail, which mounts beside
   * the landing list. The landing list always fetches on mount: its server
   * data can be a cached page restored by Back, and changes made while it was
   * unmounted arrive through no realtime event.
   */
  reuseRecent?: boolean;
}) {
  const {
    meetings,
    reminded,
    busy,
    error,
    deleteMeeting: deleteMeetingNow,
    removeFromCalendar,
    retrySync,
    sendReminder,
    clearAll: clearAllNow,
    refresh,
    prepareWithEarn,
    followUpWithEarn,
  } = useUpcomingMeetings(initialMeetings, { reuseRecent });
  const [editingId, setEditingId] = useState<string | null>(null);
  // Which meeting is expanded. One at a time: the whole point of the collapsed
  // list is that the page stays short, and a second open row undoes that.
  const [openId, setOpenId] = useState<string | null>(null);
  // Stable, so the memoised row is not invalidated by a fresh closure on every
  // clock tick. Everything it touches is a setState, so the empty dep list is
  // honest rather than a silencing.
  const toggleOpen = useCallback((id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  }, []);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);

  async function deleteMeeting(id: string, scope: "one" | "following" = "one") {
    await deleteMeetingNow(id, scope);
    setDeleteId(null);
  }

  async function clearAll() {
    await clearAllNow();
    setClearConfirm(false);
  }

  // Every label this clock drives is minute-grained ("in 5 min", "12 min
  // left", "Starts now"), so a per-second tick re-rendered the whole view for
  // text that had not changed. Fifteen seconds keeps each flip within a
  // quarter-minute of true; the hook re-reads the clock on return to the tab.
  const now = useNow(CLOCK_TICK_MS);
  const meetingIds = useMemo(() => meetings.map((m) => m.id), [meetings]);
  const { presence, recentJoins } = useLivePresence(meetingIds);

  const editingMeeting = editingId ? meetings.find((m) => m.id === editingId) : null;

  // Live roll-up for the section header: how many meetings have someone in the
  // room right now, and how many start within the hour.
  const liveCount = meetingIds.filter((id) => (presence[id]?.count ?? 0) > 0).length;
  const startingSoon = meetings.filter((m) => {
    const ts = meetingTimeState(m.scheduled_at, m.duration_minutes, now);
    return ts?.phase === "upcoming" && ts.minutesToStart <= 60;
  }).length;

  return (
    <section className="w-full">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className={EYEBROW}>
            Upcoming
            <span className="ml-2 font-normal tabular-nums text-fg-muted">{meetings.length}</span>
          </h2>
          {liveCount > 0 ? (
            <span className={chip("success")}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              {liveCount} live
            </span>
          ) : null}
          {startingSoon > 0 ? (
            <span className={chip("accent")}>{startingSoon} within the hour</span>
          ) : null}
        </div>
        {/* No Refresh button: the realtime subscription below already refetches
            on every change, so offering the control implied it didn't. Clear
            All is destructive and rare — it lives in the menu, not on top. */}
        {meetings.length > 0 ? (
          <OverflowMenu
            label="Upcoming meetings options"
            items={[{ label: "Clear all upcoming", danger: true, onSelect: () => setClearConfirm(true) }]}
          />
        ) : null}
      </div>
      {error ? (
        <p
          role="alert"
          className="mb-2 rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-[var(--status-danger)]"
        >
          {error}
        </p>
      ) : null}

      {clearConfirm ? (
        <ConfirmBox
          title="Clear all upcoming meetings?"
          body="This removes upcoming meetings from this FundExecs view only. Connected calendar events will not be deleted unless you explicitly sync or delete them from the source calendar."
          confirmLabel={busy === "__clear__" ? "Clearing..." : "Clear FundExecs view only"}
          onConfirm={() => void clearAll()}
          onCancel={() => setClearConfirm(false)}
        />
      ) : null}

      {meetings.length === 0 ? (
        <div className={`${CARD} border-dashed px-6 py-10 text-center`}>
          <p className="text-sm font-medium text-fg-primary">No upcoming meetings</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-fg-muted">
            Schedule a meeting, connect a calendar, or ask Earn to prepare your schedule.
          </p>
        </div>
      ) : null}

      <div className="grid gap-1.5">
        {meetings.map((meeting) => {
          const status = deriveMeetingStatus(meeting, now);
          const timeState = meetingTimeState(meeting.scheduled_at, meeting.duration_minutes, now);
          const room = presence[meeting.id];
          const live = (room?.count ?? 0) > 0 || timeState?.phase === "in_progress";
          const joinLabel = recentJoins.find(
            (j) => j.meetingId === meeting.id && now - j.at < 45_000,
          );
          const copilot = copilotName(meeting.assigned_copilot_agent);
          // `??` only guards null/undefined; an empty string or any value outside
          // the enum (legacy/unknown DB states) would render "calendar: undefined".
          // Validate membership so it always maps to a known label.
          const rawSync = meeting.external_calendar_sync_status;
          const syncStatus: ExternalSyncStatus =
            rawSync && rawSync in EXTERNAL_SYNC_STATUS_LABELS ? (rawSync as ExternalSyncStatus) : "not_connected";
          const prep = meeting.preparation_status ?? "prep_needed";
          // A meeting that has run its clock wants a follow-up, not a prep.
          const ended = timeState?.phase === "ended" || meeting.status === "ended";
          const isOpen = openId === meeting.id;
          return (
              <div
                key={meeting.id}
                className={`${CARD} overflow-hidden transition duration-200 ${
                  live ? "border-status-success/50" : ""
                } ${isOpen ? "shadow-[0_10px_30px_-18px_rgb(15_23_42/0.35)]" : ""}`}
              >
                {/* Collapsed: one row per meeting — when, what, where it stands,
                    and the way in. The name is the disclosure; every other
                    detail and action comes with it when it opens. Join stays
                    outside the disclosure so the common case is still one
                    click, and because a link cannot nest inside a button. */}
                <CollapsedRow
                  id={meeting.id}
                  roomCode={meeting.room_code}
                  title={meeting.title}
                  scheduledAt={meeting.scheduled_at}
                  isOpen={isOpen}
                  live={live}
                  phase={timeState?.phase ?? null}
                  countdown={timeState?.label ?? null}
                  status={status}
                  compact={compact === true}
                  onToggle={toggleOpen}
                />

                {isOpen ? (
                  <div
                    id={`meeting-panel-${meeting.id}`}
                    className="border-t border-line/70 bg-surface-0/40 px-4 py-3.5 motion-safe:animate-fade-up"
                  >
                    <p className="text-xs capitalize text-fg-secondary">
                      {(meeting.meeting_type ?? "meeting").replace(/_/g, " ")}
                      {" · "}
                      {meeting.scheduled_at ? formatScheduled(meeting.scheduled_at) : "Time TBD"}
                      {meeting.duration_minutes ? ` · ${meeting.duration_minutes} min` : ""}
                      {meeting.timezone ? ` · ${meeting.timezone}` : ""}
                    </p>

                    {/* Live presence — who is in the room right now */}
                    {room && room.count > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={chip("success")}>
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                          {room.count} in the room
                        </span>
                        <span className="truncate text-[11px] text-fg-muted">{room.names.join(", ")}</span>
                      </div>
                    ) : null}
                    {joinLabel ? (
                      <p className="mt-1 text-[11px] text-[var(--status-success)]">{joinLabel.name} just joined</p>
                    ) : null}

                    {/* One quiet line rather than four bordered pills, and no
                        second copy of the attendee list underneath it — the names
                        themselves live in the detail rows below. */}
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-muted">
                      {[
                        `prep: ${prep}`,
                        copilot ? `copilot: ${copilot}` : null,
                        `calendar: ${EXTERNAL_SYNC_STATUS_LABELS[syncStatus]}`,
                        seriesPositionLabel(meeting.series_rule, meeting.series_index)?.toLowerCase() ?? null,
                        meeting.attendees?.length
                          ? `${meeting.attendees.length} attendee${meeting.attendees.length === 1 ? "" : "s"}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                        .replace(/_/g, " ")}
                    </p>

                    <MeetingDetails meeting={meeting} />

                    {/* Open is the deliberate state, so the actions are all on
                        screen here rather than hidden a second click deep in a
                        menu. At rest the row shows none of them. */}
                    <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-line/70 pt-3">
                      <ActionButton onClick={() => (ended ? followUpWithEarn(meeting) : prepareWithEarn(meeting))}>
                        {ended ? "Follow up" : "Prepare with Earn"}
                      </ActionButton>
                      <ActionButton onClick={() => (ended ? prepareWithEarn(meeting) : followUpWithEarn(meeting))}>
                        {ended ? "Prepare with Earn" : "Follow up"}
                      </ActionButton>
                      <ActionButton onClick={() => setEditingId(meeting.id)}>Edit meeting</ActionButton>
                      <ActionButton
                        disabled={busy === meeting.id || reminded[meeting.id]?.state === "sending"}
                        onClick={() => void sendReminder(meeting.id)}
                      >
                        {reminded[meeting.id]?.state === "sending" ? "Sending…" : "Send reminder"}
                      </ActionButton>
                      {syncStatus === "sync_failed" || syncStatus === "needs_resync" ? (
                        <ActionButton disabled={busy === meeting.id} onClick={() => void retrySync(meeting.id)}>
                          Retry sync
                        </ActionButton>
                      ) : null}
                      {/* Only where there is something to remove. Offering it
                          on a meeting that was never pushed would be a button
                          that does nothing and says it succeeded. */}
                      {meeting.external_calendar_sync_enabled ? (
                        <ActionButton
                          disabled={busy === meeting.id}
                          onClick={() => void removeFromCalendar(meeting.id)}
                        >
                          {busy === meeting.id ? "Removing…" : "Remove from calendar"}
                        </ActionButton>
                      ) : null}
                      <ActionButton danger onClick={() => setDeleteId(meeting.id)}>
                        Delete
                      </ActionButton>
                    </div>

                    {reminded[meeting.id]?.message ? (
                      <p
                        role="status"
                        className={`mt-2 text-xs ${
                          reminded[meeting.id]!.state === "sent"
                            ? "text-[var(--status-success)]"
                            : "text-[var(--status-warning)]"
                        }`}
                      >
                        {reminded[meeting.id]!.message}
                      </p>
                    ) : null}

                    {deleteId === meeting.id ? (
                      <ConfirmBox
                        title={meeting.series_id ? "Delete a repeating meeting?" : "Delete this meeting?"}
                        body={
                          // Deleting now emails the guests. Say so before the click,
                          // not after — a host should never mail their LPs by accident.
                          notifiableGuestCount(meeting) > 0
                            ? `This deletes the local FundExecs meeting record only. Connected calendar events are not deleted unless separately approved and synced. ${notifiableGuestCount(meeting)} guest${
                                notifiableGuestCount(meeting) === 1 ? "" : "s"
                              } will be emailed that it's cancelled.`
                            : "This deletes the local FundExecs meeting record only. Connected calendar events are not deleted unless separately approved and synced."
                        }
                        confirmLabel={
                          busy === meeting.id
                            ? "Deleting..."
                            : meeting.series_id
                              ? "Delete this meeting"
                              : "Delete from FundExecs only"
                        }
                        onConfirm={() => void deleteMeeting(meeting.id)}
                        // One meeting of a series can go alone, or take the
                        // rest of the series with it. Guests then get one email
                        // about the series, not one per meeting.
                        alsoLabel={meeting.series_id && busy !== meeting.id ? "This and following meetings" : undefined}
                        onAlso={() => void deleteMeeting(meeting.id, "following")}
                        onCancel={() => setDeleteId(null)}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
      </div>

      {editingMeeting ? (
        <MeetingEditScreen
          mode="edit"
          initial={toEditInitial(editingMeeting)}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            void refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
