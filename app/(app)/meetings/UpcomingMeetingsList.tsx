"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AGENTS } from "@/lib/agents";
import {
  deriveMeetingStatus,
  EXTERNAL_SYNC_STATUS_LABELS,
  type MeetingDisplayStatus,
  type ExternalSyncStatus,
} from "@/lib/meetings/schedule";
import { MeetingEditScreen, type MeetingEditInitial } from "./MeetingEditScreen";

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
}

function formatScheduled(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_TONE: Record<MeetingDisplayStatus, string> = {
  Scheduled: "border-[var(--gold-400)]/40 bg-[var(--gold-400)]/10 text-[var(--gold-400)]",
  "Prep Needed": "border-[var(--status-warning,#f59e0b)]/40 bg-[var(--status-warning,#f59e0b)]/10 text-[var(--status-warning,#f59e0b)]",
  Ready: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  Updated: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  Live: "border-emerald-500/50 bg-emerald-500/15 text-emerald-400",
  Completed: "border-[var(--line)] bg-[var(--surface-0)] text-[var(--fg-muted)]",
  "Follow-Up Needed": "border-purple-500/40 bg-purple-500/10 text-purple-400",
};

function copilotName(key: string | null): string | null {
  if (!key) return null;
  return AGENTS.find((a) => a.key === key)?.name ?? key;
}

function toEditInitial(m: UpcomingMeeting): MeetingEditInitial {
  const internal = (m.attendees ?? []).filter((a) => a.type === "internal");
  const external = (m.attendees ?? []).filter((a) => a.type !== "internal");
  return {
    meetingId: m.id,
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
    internalAttendees: internal.map((a) => a.email ?? a.name).join("\n"),
    externalGuests: external.map((a) => (a.email ? `${a.name} <${a.email}>` : a.name)).join("\n"),
    assignedCopilotAgent: m.assigned_copilot_agent,
    relatedRecordType: m.related_record_type,
    relatedRecordId: m.related_record_id,
    calendarVisibility: m.calendar_visibility,
    reminderMinutes: m.reminder_minutes,
    priority: m.priority,
    tags: m.tags,
    externalCalendarSyncEnabled: m.external_calendar_sync_enabled ?? false,
    externalCalendarProvider: m.external_calendar_provider,
  };
}

export function UpcomingMeetingsList({ initialMeetings }: { initialMeetings: UpcomingMeeting[] }) {
  const [meetings, setMeetings] = useState(initialMeetings);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/meetings/upcoming", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { data?: UpcomingMeeting[] };
    setMeetings(json.data ?? []);
  }

  useEffect(() => {
    const supabase = createClient();
    void refresh();

    const channel = supabase
      .channel("upcoming-meetings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_meetings" }, () => {
        void refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

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

  function askEarn(prompt: string) {
    window.dispatchEvent(new CustomEvent("earn:set-composer-prompt", { detail: { prompt } }));
  }

  const editingMeeting = editingId ? meetings.find((m) => m.id === editingId) : null;
  const detailsMeeting = detailsId ? meetings.find((m) => m.id === detailsId) : null;

  return (
    <section className="mx-auto w-full max-w-2xl px-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
          Upcoming meetings
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={() => void refresh()} className="rounded-md border border-[var(--line)] px-2 py-1 text-xs text-[var(--fg-muted)] hover:text-[var(--fg-primary)]">
            Refresh
          </button>
          {meetings.length > 0 ? (
            <button onClick={() => setClearConfirm(true)} className="rounded-md border border-[var(--status-danger)]/35 px-2 py-1 text-xs text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10">
              Clear All
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="mb-2 rounded-lg border border-[var(--status-danger)]/30 bg-[var(--status-danger)]/10 px-3 py-2 text-xs text-[var(--status-danger)]">{error}</p> : null}

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
        <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface-1)] p-6 text-center">
          <p className="text-sm font-medium text-[var(--fg-primary)]">No upcoming meetings.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--fg-muted)]">
            Schedule a meeting, connect a calendar, or ask Earn to prepare your schedule.
          </p>
        </div>
      ) : null}

      <div className="grid gap-2">
        {meetings.map((meeting) => {
          const status = deriveMeetingStatus(meeting);
          const copilot = copilotName(meeting.assigned_copilot_agent);
          const syncStatus = (meeting.external_calendar_sync_status as ExternalSyncStatus) ?? "not_connected";
          const prep = meeting.preparation_status ?? "prep_needed";
          return (
            <div key={meeting.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
              <div className="flex items-start justify-between gap-3 pb-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_TONE[status]}`}>{status}</span>
                    <p className="text-sm font-medium text-[var(--fg-primary)]">{meeting.title}</p>
                  </div>
                  <p className="mt-1 text-xs text-[var(--fg-muted)]">
                    {(meeting.meeting_type ?? "meeting").replace(/_/g, " ")}
                    {" · "}
                    {meeting.scheduled_at ? formatScheduled(meeting.scheduled_at) : "Time TBD"}
                    {meeting.duration_minutes ? ` · ${meeting.duration_minutes} min` : ""}
                    {meeting.timezone ? ` · ${meeting.timezone}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StatusPill label={`prep: ${prep}`} />
                    {copilot ? <StatusPill label={`copilot: ${copilot}`} /> : null}
                    <StatusPill label={`calendar: ${EXTERNAL_SYNC_STATUS_LABELS[syncStatus]}`} />
                    {meeting.attendees?.length ? (
                      <StatusPill label={`${meeting.attendees.length} attendee${meeting.attendees.length === 1 ? "" : "s"}`} />
                    ) : null}
                  </div>
                  {meeting.attendees?.length ? (
                    <p className="mt-2 max-w-xl truncate text-xs text-[var(--fg-muted)]">
                      {meeting.attendees.map((a) => a.email ?? a.name).join(", ")}
                    </p>
                  ) : null}
                </div>
                <Link href={`/meetings/${meeting.room_code}`} className="shrink-0 rounded-full bg-[var(--gold-400)]/10 px-2 py-0.5 text-xs font-medium text-[var(--gold-400)]">
                  Join →
                </Link>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
                <ActionButton onClick={() => setDetailsId(detailsId === meeting.id ? null : meeting.id)}>
                  {detailsId === meeting.id ? "Hide details" : "Open details"}
                </ActionButton>
                <ActionButton onClick={() => setEditingId(meeting.id)}>Edit meeting</ActionButton>
                {syncStatus === "sync_failed" || syncStatus === "needs_resync" ? (
                  <ActionButton onClick={() => void retrySync(meeting.id)}>Retry sync</ActionButton>
                ) : null}
                <ActionButton danger onClick={() => setDeleteId(meeting.id)}>Delete</ActionButton>
                <ActionButton onClick={() => askEarn(`Prepare me for "${meeting.title}" and surface likely questions, risks, and next steps.`)}>Prepare with Earn</ActionButton>
                <ActionButton onClick={() => askEarn(`Draft a follow-up for "${meeting.title}" with action items and approval-sensitive language.`)}>Follow up</ActionButton>
              </div>

              {detailsMeeting?.id === meeting.id ? <MeetingDetails meeting={meeting} /> : null}

              {deleteId === meeting.id ? (
                <ConfirmBox
                  title="Delete this meeting?"
                  body="This deletes the local FundExecs meeting record only. Connected calendar events are not deleted unless separately approved and synced."
                  confirmLabel={busy === meeting.id ? "Deleting..." : "Delete from FundExecs only"}
                  onConfirm={() => void deleteMeeting(meeting.id)}
                  onCancel={() => setDeleteId(null)}
                />
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
    ["Related", meeting.related_record_type ? `${meeting.related_record_type}${meeting.related_record_id ? ` · ${meeting.related_record_id}` : ""}` : null],
    ["Visibility", meeting.calendar_visibility],
    ["Reminder", meeting.reminder_minutes != null ? `${meeting.reminder_minutes} min before` : null],
    ["Meeting ID", meeting.id],
    ["Room", meeting.room_code],
  ];
  return (
    <dl className="mt-3 grid gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3 text-xs">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-24 shrink-0 font-mono uppercase tracking-wider text-[var(--fg-muted)]">{k}</dt>
            <dd className="min-w-0 break-words text-[var(--fg-secondary)]">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
      {label.replace(/_/g, " ")}
    </span>
  );
}

function ActionButton({ children, onClick, danger = false }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-xs transition ${
        danger
          ? "border-[var(--status-danger)]/35 text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10"
          : "border-[var(--line)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
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
    <div className="mt-3 rounded-lg border border-[var(--status-danger)]/30 bg-[var(--status-danger)]/8 p-3">
      <p className="text-sm font-medium text-[var(--fg-primary)]">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">{body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onConfirm} className="rounded-md bg-[var(--status-danger)] px-3 py-1.5 text-xs font-medium text-white">
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--fg-secondary)]">
          Cancel
        </button>
      </div>
    </div>
  );
}
