"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AGENTS } from "@/lib/agents";
import {
  MEETING_TYPES,
  CALENDAR_VISIBILITIES,
  RELATED_RECORD_TYPES,
  EXTERNAL_CALENDAR_PROVIDERS,
  validateMeetingDraft,
  durationMinutesFromTimes,
  localToIso,
  type FieldErrors,
} from "@/lib/meetings/schedule";

export interface MeetingEditInitial {
  meetingId?: string;
  title?: string;
  meetingType?: string;
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  timezone?: string | null;
  description?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
  objective?: string | null;
  agenda?: string | null;
  preparationRequirements?: string | null;
  internalAttendees?: string;
  externalGuests?: string;
  assignedCopilotAgent?: string | null;
  relatedRecordType?: string | null;
  relatedRecordId?: string | null;
  calendarVisibility?: string | null;
  reminderMinutes?: number | null;
  priority?: "low" | "normal" | "high" | "critical" | null;
  tags?: string[] | null;
  externalCalendarSyncEnabled?: boolean;
  externalCalendarProvider?: string | null;
}

export interface MeetingSaveResult {
  id: string;
  roomCode: string;
  isDraft?: boolean;
  externalCalendarSyncStatus?: string;
  externalSyncError?: string;
}

const MEETING_TYPE_LABELS: Record<string, string> = {
  internal_strategy: "Internal strategy",
  investor_update: "Investor update",
  lp_review: "LP review",
  deal_review: "Deal review",
  diligence: "Diligence",
  portfolio_review: "Portfolio review",
  board_meeting: "Board meeting",
  external_pitch: "External pitch",
  advisory: "Advisory",
  other: "Other",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoToLocalParts(iso: string | null | undefined): { date: string; time: string } {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3600_000);
  if (isNaN(d.getTime())) return isoToLocalParts(null);
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function MeetingEditScreen({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial?: MeetingEditInitial;
  onClose: () => void;
  onSaved: (result: MeetingSaveResult) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const browserTz = useMemo(
    () => (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC") || "UTC",
    [],
  );

  const startParts = isoToLocalParts(initial?.scheduledAt);
  const initialDuration = initial?.durationMinutes ?? 60;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [meetingType, setMeetingType] = useState(initial?.meetingType ?? "internal_strategy");
  const [date, setDate] = useState(startParts.date);
  const [startTime, setStartTime] = useState(startParts.time);
  const [endTime, setEndTime] = useState(addMinutesToTime(startParts.time, initialDuration));
  const [timezone, setTimezone] = useState(initial?.timezone ?? browserTz);
  const [internalAttendees, setInternalAttendees] = useState(initial?.internalAttendees ?? "");
  const [externalGuests, setExternalGuests] = useState(initial?.externalGuests ?? "");
  const [objective, setObjective] = useState(initial?.objective ?? "");
  const [agenda, setAgenda] = useState(initial?.agenda ?? "");
  const [preparationRequirements, setPreparationRequirements] = useState(initial?.preparationRequirements ?? "");
  const [relatedRecordType, setRelatedRecordType] = useState(initial?.relatedRecordType ?? "");
  const [relatedRecordId, setRelatedRecordId] = useState(initial?.relatedRecordId ?? "");
  const [assignedCopilot, setAssignedCopilot] = useState(initial?.assignedCopilotAgent ?? "");
  const [attachments, setAttachments] = useState("");
  const [meetingUrl, setMeetingUrl] = useState(initial?.meetingUrl ?? "");
  const [calendarVisibility, setCalendarVisibility] = useState(initial?.calendarVisibility ?? "organization");
  const [reminderMinutes, setReminderMinutes] = useState(String(initial?.reminderMinutes ?? 15));
  const [syncEnabled, setSyncEnabled] = useState(initial?.externalCalendarSyncEnabled ?? false);
  const [syncProvider, setSyncProvider] = useState(initial?.externalCalendarProvider ?? "");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [conflicts, setConflicts] = useState<Array<{ id: string; title: string; scheduledAt: string }>>([]);
  const [allowConflict, setAllowConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "draft" | null>(null);

  // Keep end time sensible when start moves past it.
  useEffect(() => {
    if (durationMinutesFromTimes(startTime, endTime) <= 0) {
      setEndTime(addMinutesToTime(startTime, 60));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  function buildPayload(draft: boolean) {
    // Internal attendees prefixed so the server can tag them; simple newline/comma parse.
    const internalList = internalAttendees
      .split(/[,;\n]/)
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => ({ name: v, type: "internal" as const }));
    return {
      meetingId: initial?.meetingId,
      draft,
      allowConflict,
      title: title.trim(),
      meetingType,
      date,
      startTime,
      endTime,
      timezone,
      objective: objective.trim() || null,
      agenda: agenda.trim() || null,
      preparationRequirements: preparationRequirements.trim() || null,
      attendees: [
        ...internalList,
        ...externalGuests.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean).map((v) => ({ name: v, type: "external" as const })),
      ],
      attachments: attachments
        .split(/[\n]/)
        .map((v) => v.trim())
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/^(.*?)\s*<([^>]+)>$/);
          return m ? { name: m[1].trim() || m[2].trim(), url: m[2].trim() } : { name: line };
        }),
      assignedCopilotAgent: assignedCopilot || null,
      relatedRecordType: relatedRecordType || null,
      relatedRecordId: relatedRecordId.trim() || null,
      meetingUrl: meetingUrl.trim() || null,
      calendarVisibility,
      reminderMinutes: reminderMinutes ? Number(reminderMinutes) : null,
      externalCalendarSyncEnabled: syncEnabled,
      externalCalendarProvider: syncProvider || null,
    };
  }

  async function submit(draft: boolean) {
    setError(null);
    setNotice(null);
    const errors = validateMeetingDraft({ title, meetingType, date, startTime, endTime, timezone });
    if (!draft && Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Please complete the required fields.");
      return;
    }
    setFieldErrors({});
    setBusy(draft ? "draft" : "save");

    try {
      const payload = buildPayload(draft);
      // Edits to an already-saved meeting go through the deliberate PATCH path
      // so prep state is preserved and the external mirror is re-synced.
      const isExistingEdit = mode === "edit" && initial?.meetingId;
      const res = await fetch(isExistingEdit ? `/api/meetings/${initial!.meetingId}` : "/api/meetings/schedule", {
        method: isExistingEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isExistingEdit
            ? {
                title: payload.title,
                meetingType: payload.meetingType,
                scheduledAt: localToIso(date, startTime, payload.timezone),
                durationMinutes: durationMinutesFromTimes(startTime, endTime),
                timezone: payload.timezone,
                objective: payload.objective,
                agenda: payload.agenda,
                preparationRequirements: payload.preparationRequirements,
                attendees: payload.attendees,
                attachments: payload.attachments,
                assignedCopilotAgent: payload.assignedCopilotAgent,
                relatedRecordType: payload.relatedRecordType,
                relatedRecordId: payload.relatedRecordId,
                meetingUrl: payload.meetingUrl,
                calendarVisibility: payload.calendarVisibility,
                reminderMinutes: payload.reminderMinutes,
                externalCalendarProvider: payload.externalCalendarProvider,
                externalCalendarSyncEnabled: payload.externalCalendarSyncEnabled,
              }
            : payload,
        ),
      });

      if (res.status === 422) {
        const json = (await res.json()) as { fieldErrors?: FieldErrors };
        setFieldErrors(json.fieldErrors ?? {});
        setError("Please complete the required fields.");
        return;
      }
      if (res.status === 409) {
        const json = (await res.json()) as { conflicts?: Array<{ id: string; title: string; scheduledAt: string }> };
        setConflicts(json.conflicts ?? []);
        setError("This time conflicts with another meeting.");
        return;
      }
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Failed to save meeting");
      }

      const json = (await res.json().catch(() => ({}))) as MeetingSaveResult & { externalSyncError?: string };
      if (json.externalSyncError) {
        setNotice(`Meeting saved, external calendar sync failed: ${json.externalSyncError}`);
      }
      onSaved({
        id: json.id ?? initial?.meetingId ?? "",
        roomCode: json.roomCode ?? "",
        isDraft: draft,
        externalCalendarSyncStatus: json.externalCalendarSyncStatus,
        externalSyncError: json.externalSyncError,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 backdrop-blur-sm sm:items-start sm:p-6"
    >
      <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-[var(--surface-1)] shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl sm:border sm:border-[var(--line)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
              {mode === "edit" ? "Edit meeting" : "Schedule meeting"}
            </h2>
            <p className="text-xs text-[var(--fg-muted)]">Configure details, then save to lock into your calendar.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="flex flex-col gap-6">
            <Section title="Overview">
              <TextField label="Meeting title" required value={title} onChange={setTitle} error={fieldErrors.title} placeholder="e.g. Q3 LP Review" />
              <SelectField
                label="Meeting type"
                required
                value={meetingType}
                onChange={setMeetingType}
                error={fieldErrors.meetingType}
                options={MEETING_TYPES.map((t) => ({ value: t, label: MEETING_TYPE_LABELS[t] ?? t }))}
              />
            </Section>

            <Section title="Schedule">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Date" required type="date" value={date} onChange={setDate} error={fieldErrors.date} />
                <TextField label="Time zone" required value={timezone} onChange={setTimezone} error={fieldErrors.timezone} />
                <TextField label="Start time" required type="time" value={startTime} onChange={setStartTime} error={fieldErrors.startTime} />
                <TextField label="End time" required type="time" value={endTime} onChange={setEndTime} error={fieldErrors.endTime} />
              </div>
            </Section>

            <Section title="Participants">
              <TextArea label="Internal attendees" value={internalAttendees} onChange={setInternalAttendees} hint="Names or emails, separated by commas or new lines." />
              <TextArea label="External guests" value={externalGuests} onChange={setExternalGuests} hint="Guest emails, e.g. Jane Doe <jane@fund.com>." />
            </Section>

            <Section title="Context">
              <TextArea label="Meeting objective" value={objective} onChange={setObjective} />
              <TextArea label="Agenda" value={agenda} onChange={setAgenda} />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label="Related record"
                  value={relatedRecordType}
                  onChange={setRelatedRecordType}
                  options={[{ value: "", label: "None" }, ...RELATED_RECORD_TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))]}
                />
                <TextField label="Record ID" value={relatedRecordId} onChange={setRelatedRecordId} placeholder="Optional record UUID" />
                <SelectField
                  label="Assigned copilot"
                  value={assignedCopilot}
                  onChange={setAssignedCopilot}
                  options={[{ value: "", label: "None" }, ...AGENTS.map((a) => ({ value: a.key, label: a.name }))]}
                />
                <TextField label="Meeting link" value={meetingUrl} onChange={setMeetingUrl} placeholder="Optional external link" />
              </div>
              <TextArea label="Preparation requirements" value={preparationRequirements} onChange={setPreparationRequirements} />
              <TextArea label="Attachments / linked documents" value={attachments} onChange={setAttachments} hint="One per line. Name <https://link> or a plain label." />
            </Section>

            <Section title="Calendar & reminders">
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label="Calendar visibility"
                  value={calendarVisibility}
                  onChange={setCalendarVisibility}
                  options={CALENDAR_VISIBILITIES.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))}
                />
                <SelectField
                  label="Reminder"
                  value={reminderMinutes}
                  onChange={setReminderMinutes}
                  options={[
                    { value: "", label: "No reminder" },
                    { value: "5", label: "5 min before" },
                    { value: "15", label: "15 min before" },
                    { value: "30", label: "30 min before" },
                    { value: "60", label: "1 hour before" },
                    { value: "1440", label: "1 day before" },
                  ]}
                />
              </div>
              <label className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5">
                <input type="checkbox" checked={syncEnabled} onChange={(e) => setSyncEnabled(e.target.checked)} className="mt-0.5" />
                <span className="text-xs text-[var(--fg-secondary)]">
                  Sync to a third-party calendar after saving. The native FundExecs calendar always remains the source of truth.
                </span>
              </label>
              {syncEnabled ? (
                <SelectField
                  label="Third-party provider"
                  value={syncProvider}
                  onChange={setSyncProvider}
                  options={[
                    { value: "", label: "Select provider" },
                    ...EXTERNAL_CALENDAR_PROVIDERS.map((p) => ({ value: p, label: p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) })),
                  ]}
                />
              ) : null}
            </Section>

            {conflicts.length > 0 ? (
              <div className="rounded-lg border border-[var(--status-warning,#f59e0b)]/40 bg-[var(--status-warning,#f59e0b)]/10 px-3 py-3">
                <p className="text-xs font-medium text-[var(--fg-primary)]">Scheduling conflict</p>
                <ul className="mt-1 list-disc pl-4 text-xs text-[var(--fg-muted)]">
                  {conflicts.map((c) => (
                    <li key={c.id}>{c.title} — {new Date(c.scheduledAt).toLocaleString()}</li>
                  ))}
                </ul>
                <label className="mt-2 flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
                  <input type="checkbox" checked={allowConflict} onChange={(e) => setAllowConflict(e.target.checked)} />
                  Save anyway
                </label>
              </div>
            ) : null}

            {notice ? <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-xs text-[var(--fg-secondary)]">{notice}</p> : null}
            {error ? <p className="rounded-lg border border-[var(--status-danger)]/30 bg-[var(--status-danger)]/10 px-3 py-2 text-xs text-[var(--status-danger)]">{error}</p> : null}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]">
            Cancel
          </button>
          {mode === "create" ? (
            <button
              type="button"
              onClick={() => void submit(true)}
              disabled={busy !== null}
              className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] disabled:opacity-50"
            >
              {busy === "draft" ? "Saving…" : "Save as draft"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={busy !== null}
            className="rounded-lg bg-[var(--gold-400)] px-4 py-2 text-xs font-semibold text-black hover:bg-[var(--gold-500)] disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : mode === "edit" ? "Save Changes" : "Save Meeting"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">{title}</h3>
      {children}
    </section>
  );
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className="text-xs font-medium text-[var(--fg-secondary)]">
      {label} {required ? <span className="text-[var(--status-danger)]">*</span> : null}
    </span>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  error?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel label={label} required={required} />
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`rounded-lg border bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] ${
          error ? "border-[var(--status-danger)]" : "border-[var(--line)]"
        }`}
      />
      {error ? <span className="text-[11px] text-[var(--status-danger)]">{error}</span> : null}
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel label={label} />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
      />
      {hint ? <span className="text-[11px] leading-snug text-[var(--fg-muted)]">{hint}</span> : null}
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  error?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel label={label} required={required} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-lg border bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] ${
          error ? "border-[var(--status-danger)]" : "border-[var(--line)]"
        }`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-[var(--status-danger)]">{error}</span> : null}
    </label>
  );
}
