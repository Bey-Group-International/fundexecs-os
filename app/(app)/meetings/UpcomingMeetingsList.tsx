"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatAttendeeInput, parseAttendeeInput } from "@/lib/meetings/attendees";

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
}

function formatScheduled(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function UpcomingMeetingsList({ initialMeetings }: { initialMeetings: UpcomingMeeting[] }) {
  const [meetings, setMeetings] = useState(initialMeetings);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/meetings/upcoming", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json() as { data?: UpcomingMeeting[] };
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
      const json = await res.json().catch(() => ({})) as { error?: string };
      setError(json.error ?? "Failed to delete meeting");
    } else {
      setMeetings((prev) => prev.filter((m) => m.id !== id));
    }
    setDeleteId(null);
    setBusy(null);
  }

  async function clearAll() {
    setBusy("__clear__");
    setError(null);
    const res = await fetch("/api/meetings/clear-all", { method: "POST" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({})) as { error?: string };
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
            Add a meeting, connect a calendar, or ask Earn to prepare your schedule.
          </p>
        </div>
      ) : null}

      <div className="grid gap-2">
        {meetings.map((meeting) => editingId === meeting.id ? (
          <EditMeetingCard
            key={meeting.id}
            meeting={meeting}
            onCancel={() => setEditingId(null)}
            onSaved={() => {
              setEditingId(null);
              void refresh();
            }}
          />
        ) : (
          <div key={meeting.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
            <div className="flex items-start justify-between gap-3 pb-3">
              <div>
                <p className="text-sm font-medium text-[var(--fg-primary)]">{meeting.title}</p>
                <p className="mt-1 text-xs text-[var(--fg-muted)]">
                  {meeting.scheduled_at ? formatScheduled(meeting.scheduled_at) : "Time TBD"}
                  {meeting.duration_minutes ? ` · ${meeting.duration_minutes} min` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusPill label={meeting.source ?? "fundexecs"} />
                  <StatusPill label={meeting.sync_status ?? "local_only"} />
                  {meeting.priority ? <StatusPill label={meeting.priority} /> : null}
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
              <Link href={`/meetings/${meeting.room_code}`} className="rounded-full bg-[var(--gold-400)]/10 px-2 py-0.5 text-xs font-medium text-[var(--gold-400)]">
                Join →
              </Link>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
              <ActionButton onClick={() => setEditingId(meeting.id)}>Edit</ActionButton>
              <ActionButton danger onClick={() => setDeleteId(meeting.id)}>Delete</ActionButton>
              <ActionButton onClick={() => askEarn(`Prepare me for "${meeting.title}" and surface likely questions, risks, and next steps.`)}>Prepare with Earn</ActionButton>
              <ActionButton onClick={() => askEarn(`Draft a follow-up for "${meeting.title}" with action items and approval-sensitive language.`)}>Follow up</ActionButton>
              <ActionButton onClick={() => askEarn(`Attach "${meeting.title}" to the relevant deal, contact, or fund record and explain what context is missing.`)}>Attach context</ActionButton>
            </div>
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
        ))}
      </div>
    </section>
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

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function csvToList(value: string): string[] {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

function EditMeetingCard({
  meeting,
  onCancel,
  onSaved,
}: {
  meeting: UpcomingMeeting;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(meeting.title);
  const [description, setDescription] = useState(meeting.description ?? "");
  const [location, setLocation] = useState(meeting.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState(meeting.meeting_url ?? "");
  const [scheduledAt, setScheduledAt] = useState(toLocalInputValue(meeting.scheduled_at));
  const [duration, setDuration] = useState(String(meeting.duration_minutes ?? 60));
  const [meetingType, setMeetingType] = useState(meeting.meeting_type ?? "internal");
  const [priority, setPriority] = useState(meeting.priority ?? "normal");
  const [tags, setTags] = useState((meeting.tags ?? []).join(", "));
  const [attendees, setAttendees] = useState(formatAttendeeInput(meeting.attendees));
  const [syncMode, setSyncMode] = useState<"local_only" | "pending_external">("local_only");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        location,
        meetingUrl,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        durationMinutes: Number(duration),
        meetingType,
        priority,
        tags: csvToList(tags),
        attendees: parseAttendeeInput(attendees),
        syncMode,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({})) as { error?: string };
      setError(json.error ?? "Failed to update meeting");
      return;
    }
    onSaved();
  }

  const externalSource = meeting.source && meeting.source !== "fundexecs" && meeting.source !== "manual";

  return (
    <div className="rounded-xl border border-[var(--gold-400)]/35 bg-[var(--surface-1)] p-4">
      <div className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-xs text-[var(--fg-muted)]">
        {externalSource
          ? "This meeting came from a connected source. Local edits stay in FundExecs unless you choose pending external sync."
          : "This is a FundExecs-native meeting. Edits update the local meeting record only."}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" value={title} onChange={setTitle} />
        <Field label="Start" value={scheduledAt} onChange={setScheduledAt} type="datetime-local" />
        <Field label="Duration minutes" value={duration} onChange={setDuration} type="number" />
        <Field label="Location" value={location} onChange={setLocation} />
        <Field label="Meeting link" value={meetingUrl} onChange={setMeetingUrl} />
        <Field label="Meeting type" value={meetingType} onChange={setMeetingType} />
        <Field
          label="Priority"
          value={priority}
          onChange={(value) => {
            if (value === "low" || value === "normal" || value === "high" || value === "critical") {
              setPriority(value);
            }
          }}
        />
        <Field label="Tags (comma separated)" value={tags} onChange={setTags} />
        <Field
          label="Guest emails"
          value={attendees}
          onChange={setAttendees}
          className="sm:col-span-2"
          hint="Enter emails separated by commas, semicolons, or new lines. Optional: Name <email@company.com>."
        />
        <Field label="Description / notes" value={description} onChange={setDescription} className="sm:col-span-2" />
      </div>
      {externalSource ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <label className="flex items-center gap-2 text-[var(--fg-secondary)]">
            <input type="radio" checked={syncMode === "local_only"} onChange={() => setSyncMode("local_only")} />
            Update FundExecs only
          </label>
          <label className="flex items-center gap-2 text-[var(--fg-secondary)]">
            <input type="radio" checked={syncMode === "pending_external"} onChange={() => setSyncMode("pending_external")} />
            Mark pending connected-calendar approval
          </label>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-xs text-[var(--status-danger)]">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} disabled={saving} className="rounded-md bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
          {saving ? "Saving..." : "Save Changes"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--fg-secondary)]">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  className = "",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  className?: string;
  hint?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-[var(--fg-secondary)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
      />
      {hint ? <span className="text-[11px] leading-snug text-[var(--fg-muted)]">{hint}</span> : null}
    </label>
  );
}
