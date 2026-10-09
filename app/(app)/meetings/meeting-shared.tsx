"use client";

// app/(app)/meetings/meeting-shared.tsx
// The pieces of an upcoming meeting that more than one view draws: the detail
// list, the action buttons and confirmations, the overflow menu, and the
// lazily-loaded edit screen. Split out of UpcomingMeetingsList so the meetings
// workspace and the calendar's rail render one meeting the same way.
import { useEffect, useRef, useState } from "react";
import nextDynamic from "next/dynamic";
import { AGENTS } from "@/lib/agents";
import type { MeetingEditInitial } from "./MeetingEditScreen";
import { MeetingShareLink } from "./MeetingShareLink";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";

/**
 * A placeholder while the scheduling form arrives.
 *
 * It is opened by a click, so the click has to be answered by something —
 * otherwise the Edit button looks dead for as long as the chunk takes.
 */
function ScheduleFormLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-3 text-xs text-[var(--fg-muted)]">
        Opening the scheduler…
      </p>
    </div>
  );
}

// Split out of the landing bundle, for the reason the calendar already is: this
// form is the second-largest component on the page and renders only once
// somebody opens it, so shipping it with the initial payload charged every visit
// for a modal most visits never see.
export const MeetingEditScreen = nextDynamic(
  () => import("./MeetingEditScreen").then((m) => m.MeetingEditScreen),
  { ssr: false, loading: () => <ScheduleFormLoading /> },
);

export function formatScheduled(iso: string) {
  return LONG_FORMAT.format(new Date(iso));
}

const LONG_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** The collapsed row's time column: short enough to sit on one line beside the
 * title without pushing the status chip and Join button off the end. */
export function formatScheduledShort(iso: string) {
  return SHORT_FORMAT.format(new Date(iso));
}

// Built once. toLocaleString with options constructs a new Intl.DateTimeFormat
// on every call, and the list re-renders every second for its countdowns — up
// to a hundred rows, so a hundred formatters a second for text that never
// changes.
const SHORT_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function copilotName(key: string | null): string | null {
  if (!key) return null;
  return AGENTS.find((a) => a.key === key)?.name ?? key;
}

/** How many guests a cancellation would actually reach — an attendee with no
 * email address is on the meeting but not reachable by it. */
export function notifiableGuestCount(m: { attendees: UpcomingMeeting["attendees"] }): number {
  return new Set((m.attendees ?? []).map((a) => a.email?.trim().toLowerCase()).filter(Boolean)).size;
}

export function toEditInitial(m: UpcomingMeeting): MeetingEditInitial {
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
    seriesId: m.series_id ?? null,
    seriesRule: m.series_rule ?? null,
  };
}

export function MeetingDetails({ meeting }: { meeting: UpcomingMeeting }) {
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
            meetingUrl={meeting.meeting_url}
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
export function OverflowMenu({
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

export function ActionButton({
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

export function ConfirmBox({
  title,
  body,
  confirmLabel,
  onConfirm,
  alsoLabel,
  onAlso,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** A second, wider way to confirm, such as the rest of a series. */
  alsoLabel?: string;
  onAlso?: () => void;
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
        {alsoLabel && onAlso ? (
          <button
            type="button"
            onClick={onAlso}
            className="fx-btn rounded-lg border border-status-danger/50 px-3 py-1.5 text-xs font-semibold text-[var(--status-danger)] hover:bg-status-danger/10"
          >
            {alsoLabel}
          </button>
        ) : null}
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
