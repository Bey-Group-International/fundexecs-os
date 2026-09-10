"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AGENTS } from "@/lib/agents";
import {
  deriveMeetingStatus,
  meetingTimeState,
  EXTERNAL_SYNC_STATUS_LABELS,
  type ExternalSyncStatus,
} from "@/lib/meetings/schedule";
import { CARD, COUNTDOWN_TONE, EYEBROW, STATUS_TONE, chip } from "./tone";
import { MeetingEditScreen, type MeetingEditInitial } from "./MeetingEditScreen";
import { MeetingShareLink } from "./MeetingShareLink";
import { useNow, useLivePresence, nextChannelName } from "./hooks";

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
  related_company_id: string | null;
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
}

function formatScheduled(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The collapsed row's time column: short enough to sit on one line beside the
 * title without pushing the status chip and Join button off the end. */
function formatScheduledShort(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function copilotName(key: string | null): string | null {
  if (!key) return null;
  return AGENTS.find((a) => a.key === key)?.name ?? key;
}

/** How many guests a cancellation would actually reach — an attendee with no
 * email address is on the meeting but not reachable by it. */
function notifiableGuestCount(m: { attendees: UpcomingMeeting["attendees"] }): number {
  return new Set((m.attendees ?? []).map((a) => a.email?.trim().toLowerCase()).filter(Boolean)).size;
}

function toEditInitial(m: UpcomingMeeting): MeetingEditInitial {
  const internal = (m.attendees ?? []).filter((a) => a.type === "internal");
  const external = (m.attendees ?? []).filter((a) => a.type !== "internal");
  return {
    meetingId: m.id,
    isDraft: m.is_draft ?? false,
    title: m.title,
    meetingType: m.meeting_type ?? "internal_strategy",
    scheduledAt: m.scheduled_at,
    durationMinutes: m.duration_minutes,
    timezone: m.timezone,
    description: m.description,
    location: m.location,
    meetingUrl: m.meeting_url,
    objective: m.objective,
    agenda: m.agenda,
    preparationRequirements: m.preparation_requirements,
    // Structured, not re-serialised into "Name <email>" for the form to parse
    // back out again. Everyone is passed through, address or not: the edit
    // screen shows the address-less ones separately rather than dropping them,
    // so opening a meeting and saving it cannot quietly erase an attendee.
    attendees: [
      ...internal.map((a) => ({ name: a.name || a.email || "", email: a.email, type: "internal" as const })),
      ...external.map((a) => ({ name: a.name || a.email || "", email: a.email, type: "external" as const })),
    ].filter((a) => a.name || a.email),
    assignedCopilotAgent: m.assigned_copilot_agent,
    relatedRecordType: m.related_record_type,
    relatedRecordId: m.related_record_id,
    calendarVisibility: m.calendar_visibility,
    reminderMinutes: m.reminder_minutes,
    priority: m.priority,
    tags: m.tags,
    externalCalendarSyncEnabled: m.external_calendar_sync_enabled ?? false,
    externalCalendarProvider: m.external_calendar_provider,
    guestQuickAccess: m.guest_quick_access ?? false,
  };
}

export function UpcomingMeetingsList({
  initialMeetings,
  compact = false,
}: {
  initialMeetings: UpcomingMeeting[];
  /** Rail variant: drop the row's time column so it fits a narrow sidebar. */
  compact?: boolean;
}) {
  const [meetings, setMeetings] = useState(initialMeetings);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Per-meeting outcome of the reminder button, so one meeting's result never
  // appears under another.
  const [reminded, setReminded] = useState<Record<string, { state: "sending" | "sent" | "failed"; message?: string }>>({});
  // Which meeting is expanded. One at a time: the whole point of the collapsed
  // list is that the page stays short, and a second open row undoes that.
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinct per mount so a second instance (e.g. inside the calendar overlay)
  // doesn't collide on a shared realtime channel.
  const [channelName] = useState(() => nextChannelName("upcoming-meetings"));

  const now = useNow(1000);
  const meetingIds = useMemo(() => meetings.map((m) => m.id), [meetings]);
  const { presence, recentJoins } = useLivePresence(meetingIds);

  async function refresh() {
    const res = await fetch("/api/meetings/upcoming", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { data?: UpcomingMeeting[] };
    setMeetings(json.data ?? []);
  }

  useEffect(() => {
    const supabase = createClient();
    void refresh();

    // Coalesce bursts of postgres changes into a single refetch so a save that
    // fires several row events doesn't trigger a refetch storm.
    function scheduleRefresh() {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), 350);
    }

    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_meetings" }, () => {
        scheduleRefresh();
      })
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [channelName]);

  async function deleteMeeting(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/meetings/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Failed to delete meeting");
    } else {
      setMeetings((prev) => prev.filter((m) => m.id !== id));
    }
    setDeleteId(null);
    setBusy(null);
  }

  async function retrySync(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/meetings/${id}/sync`, { method: "POST" });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "External calendar sync failed");
    }
    await refresh();
    setBusy(null);
  }

  /**
   * Email everyone on the meeting a reminder, now.
   *
   * The outcome is reported per meeting rather than in the shared error banner:
   * "sent to 3" is the answer to the question the host just asked, and a
   * refusal (too far out, nobody has an address, one just went out) is
   * information rather than a failure.
   */
  async function sendReminder(id: string) {
    setBusy(id);
    setError(null);
    setReminded((prev) => ({ ...prev, [id]: { state: "sending" } }));
    try {
      const res = await fetch(`/api/meetings/${id}/remind`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        sent?: number;
        total?: number;
        error?: string;
        warning?: string;
      };
      if (res.ok && (json.sent ?? 0) > 0) {
        const reach = `Reminder sent to ${json.sent}${json.total && json.total !== json.sent ? ` of ${json.total}` : ""}`;
        setReminded((prev) => ({
          ...prev,
          // A warning still means the emails went out, so it reads as sent —
          // but the host is told before they press the button a second time.
          [id]: { state: "sent", message: json.warning ? `${reach}. ${json.warning}` : reach },
        }));
      } else {
        setReminded((prev) => ({ ...prev, [id]: { state: "failed", message: json.error ?? "Could not send the reminder" } }));
      }
    } catch {
      setReminded((prev) => ({ ...prev, [id]: { state: "failed", message: "Could not reach the server" } }));
    } finally {
      // refresh() can reject on its own. Outside a finally that would leave
      // busy set forever, and this meeting's buttons disabled until the page is
      // reloaded — a failed refresh must not cost the host the row.
      try {
        await refresh();
      } finally {
        setBusy(null);
      }
    }
  }

  async function clearAll() {
    setBusy("__clear__");
    setError(null);
    const res = await fetch("/api/meetings/clear-all", { method: "POST" });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Failed to clear meetings");
    } else {
      setMeetings([]);
    }
    setClearConfirm(false);
    setBusy(null);
  }

  // Open the Earn dock with a clean, user-facing one-liner and run it. The rich
  // institutional context (deal financials, lead contacts, saved notes) is NOT
  // sent from here — only the meeting id + mode travel in `chatContext`, and the
  // server gathers and injects the sensitive context into the model call. Nothing
  // confidential is ever shown in the composer, persisted client-side, or exposed
  // over the network to the browser.
  function runWithEarn(prompt: string, chatContext: { id: string; mode: "prep" | "followup" }) {
    window.dispatchEvent(
      new CustomEvent("earn:open-with-context", { detail: { prompt, autoSend: true, chatContext } }),
    );
  }

  // "Prepare with Earn": Earn opens and streams a full institutional prep
  // briefing; the operator sees only this clean line as their message.
  function prepareWithEarn(meeting: UpcomingMeeting) {
    runWithEarn(`Prepare me for "${meeting.title}".`, { id: meeting.id, mode: "prep" });
  }

  // "Follow up": Earn opens and streams a full institutional follow-up (recap,
  // owners/dates, approval-sensitive language); the operator sees only this line.
  function followUpWithEarn(meeting: UpcomingMeeting) {
    runWithEarn(`Draft the follow-up for "${meeting.title}".`, { id: meeting.id, mode: "followup" });
  }

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
                <div className="flex items-center gap-1 pr-2">
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : meeting.id)}
                    aria-expanded={isOpen}
                    aria-controls={`meeting-panel-${meeting.id}`}
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
                        {meeting.scheduled_at ? formatScheduledShort(meeting.scheduled_at) : "Time TBD"}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary">
                      {meeting.title}
                    </span>
                    {timeState && timeState.phase !== "ended" ? (
                      <span className={`${chip(COUNTDOWN_TONE[timeState.phase])} hidden sm:inline-flex`}>
                        {timeState.phase === "imminent" || timeState.phase === "in_progress" ? (
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                        ) : null}
                        {timeState.phase === "in_progress" ? "In progress" : timeState.label}
                      </span>
                    ) : null}
                    <span className={chip(STATUS_TONE[status])}>{status}</span>
                  </button>
                  <Link
                    href={`/meetings/${meeting.room_code}`}
                    className={`fx-btn shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      live
                        ? "bg-[var(--status-success)] text-white hover:opacity-90"
                        : "border border-gold-400/35 bg-gold-400/10 text-[var(--gold-300)] hover:bg-gold-400/20"
                    }`}
                  >
                    {live ? "Join live" : "Join"}
                  </Link>
                </div>

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
                        title="Delete this meeting?"
                        body={
                          // Deleting now emails the guests. Say so before the click,
                          // not after — a host should never mail their LPs by accident.
                          notifiableGuestCount(meeting) > 0
                            ? `This deletes the local FundExecs meeting record only. Connected calendar events are not deleted unless separately approved and synced. ${notifiableGuestCount(meeting)} guest${
                                notifiableGuestCount(meeting) === 1 ? "" : "s"
                              } will be emailed that it's cancelled.`
                            : "This deletes the local FundExecs meeting record only. Connected calendar events are not deleted unless separately approved and synced."
                        }
                        confirmLabel={busy === meeting.id ? "Deleting..." : "Delete from FundExecs only"}
                        onConfirm={() => void deleteMeeting(meeting.id)}
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

function MeetingDetails({ meeting }: { meeting: UpcomingMeeting }) {
  const rows: Array<[string, string | null | undefined]> = [
    ["Objective", meeting.objective],
    ["Agenda", meeting.agenda],
    ["Preparation", meeting.preparation_requirements],
    ["Attendees", meeting.attendees?.length ? meeting.attendees.map((a) => a.email ?? a.name).join(", ") : null],
    ["Related", meeting.related_record_type ? `${meeting.related_record_type}${meeting.related_record_id ? ` · ${meeting.related_record_id}` : ""}` : null],
    ["Visibility", meeting.calendar_visibility],
    ["Reminder", meeting.reminder_minutes != null ? `${meeting.reminder_minutes} min before` : null],
    ["Meeting ID", meeting.id],
  ];
  const present = rows.filter(([, v]) => v);
  // The share row always renders: a meeting always has a link, and this is the
  // one place outside a live call where you can get at it.
  return (
    <dl className="mt-3 divide-y divide-line/60 overflow-hidden rounded-lg border border-line/70 bg-surface-1 text-xs">
      {present.map(([k, v]) => (
        <div key={k} className="flex gap-3 px-3 py-2">
          <dt className="w-24 shrink-0 font-mono text-[10px] uppercase leading-5 tracking-[0.1em] text-fg-muted">
            {k}
          </dt>
          <dd className="min-w-0 whitespace-pre-line break-words leading-5 text-fg-secondary">{v}</dd>
        </div>
      ))}
      {/* This used to be `Room: abc-def-gh` — the code, as text, which you
          could read but not use. Sharing a meeting meant joining it first to
          reach the copy button in the call. It is the actual link now. */}
      <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:gap-3">
        <dt className="w-24 shrink-0 font-mono text-[10px] uppercase leading-5 tracking-[0.1em] text-fg-muted">
          Guest link
        </dt>
        <dd className="min-w-0 flex-1">
          <MeetingShareLink
            roomCode={meeting.room_code}
            title={meeting.title}
            scheduledAt={meeting.scheduled_at}
            timeZone={meeting.timezone}
          />
        </dd>
      </div>
    </dl>
  );
}


/**
 * A "⋯" disclosure for the actions that don't need to be on screen at rest.
 * Closes on outside click, on Escape, and after any selection.
 */
function OverflowMenu({
  label,
  items,
}: {
  label: string;
  items: Array<{ label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fx-btn rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-xs leading-none text-fg-muted hover:bg-surface-2 hover:text-fg-primary"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1.5 w-52 overflow-hidden rounded-xl border border-line bg-surface-1 py-1 shadow-[0_18px_40px_-20px_rgb(15_23_42/0.45)]"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`block w-full px-3 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                item.danger
                  ? "text-[var(--status-danger)] hover:bg-status-danger/10"
                  : "text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ActionButton({
  children,
  onClick,
  danger = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`fx-btn rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
        danger
          ? "border-status-danger/40 text-[var(--status-danger)] hover:bg-status-danger/10"
          : "border-line bg-surface-1 text-fg-secondary hover:border-gold-400/40 hover:bg-surface-2 hover:text-fg-primary"
      }`}
    >
      {children}
    </button>
  );
}

function ConfirmBox({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={title}
      className="mt-3 rounded-xl border border-status-danger/40 bg-status-danger/5 p-3.5"
    >
      <p className="text-sm font-semibold text-fg-primary">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-fg-secondary">{body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="fx-btn rounded-lg bg-[var(--status-danger)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="fx-btn rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
