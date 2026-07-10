"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AGENTS } from "@/lib/agents";
import { parseAttendeeInput } from "@/lib/meetings/attendees";
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

// Common institutional meeting lengths. "Custom" reveals an explicit end time.
const DURATION_PRESETS = [
  { minutes: 30, label: "30m" },
  { minutes: 45, label: "45m" },
  { minutes: 60, label: "1h" },
  { minutes: 90, label: "1h 30m" },
  { minutes: 120, label: "2h" },
];

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

function formatEndCaption(startTime: string, endTime: string, timezone: string): string {
  if (!/^\d{2}:\d{2}$/.test(endTime)) return "";
  const [h, m] = endTime.split(":").map(Number);
  // Format the HH:mm wall clock directly. The timezone is a display label only;
  // routing through Date here would just cancel out against the browser zone.
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  const pretty = `${h12}:${String(m).padStart(2, "0")} ${period}`;
  const mins = durationMinutesFromTimes(startTime, endTime);
  const dur = mins > 0 ? ` · ${mins} min` : "";
  return `Ends ${pretty}${dur} · ${timezone}`;
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
  // "Custom" end time is only surfaced when the starting duration isn't one of
  // the presets, keeping the common path down to a single tap.
  const [customEnd, setCustomEnd] = useState(!DURATION_PRESETS.some((p) => p.minutes === initialDuration));
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
  // Preserved from initial (e.g. an imported external link) but not user-editable;
  // the built-in FundExecs room is the video conference for meetings created here.
  const [meetingUrl] = useState(initial?.meetingUrl ?? "");
  const [calendarVisibility, setCalendarVisibility] = useState(initial?.calendarVisibility ?? "organization");
  // An explicit null on edit means the meeting was saved with "No reminder" — a
  // deliberate non-default choice — so preserve it rather than coercing to 15.
  const [reminderMinutes, setReminderMinutes] = useState(
    initial?.reminderMinutes === null ? "" : String(initial?.reminderMinutes ?? 15),
  );
  const [syncEnabled, setSyncEnabled] = useState(initial?.externalCalendarSyncEnabled ?? false);
  const [syncProvider, setSyncProvider] = useState(initial?.externalCalendarProvider ?? "");

  // Video conferencing is the built-in FundExecs room — no external service.
  // `meetingUrl` is still carried through the payload so an externally-imported
  // link (e.g. from a synced calendar event) isn't wiped on edit, but the form
  // never asks the user to paste an external link.

  // Advanced options stay collapsed by default; auto-open on edit when the
  // meeting already carries advanced configuration so nothing looks lost.
  const [advancedOpen, setAdvancedOpen] = useState(
    mode === "edit" &&
      Boolean(
        initial?.relatedRecordType ||
          initial?.assignedCopilotAgent ||
          initial?.meetingUrl ||
          initial?.preparationRequirements ||
          initial?.externalCalendarSyncEnabled ||
          // null reminder = "No reminder", a deliberate non-default (default 15).
          initial?.reminderMinutes !== 15 ||
          (initial?.calendarVisibility != null && initial.calendarVisibility !== "organization"),
      ),
  );

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [conflicts, setConflicts] = useState<Array<{ id: string; title: string; scheduledAt: string }>>([]);
  const [allowConflict, setAllowConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "draft" | null>(null);
  const [savedResult, setSavedResult] = useState<MeetingSaveResult | null>(null);

  const activeDuration = durationMinutesFromTimes(startTime, endTime);

  function chooseDuration(minutes: number) {
    setCustomEnd(false);
    setEndTime(addMinutesToTime(startTime, minutes));
  }

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
    // parseAttendeeInput extracts "Name <email>" / bare emails into a validated
    // { name, email } shape; we just override the type per field. Without this
    // the raw string lands in `name` and the email is lost.
    const internalList = parseAttendeeInput(internalAttendees).map((a) => ({ ...a, type: "internal" as const }));
    const externalList = parseAttendeeInput(externalGuests).map((a) => ({ ...a, type: "external" as const }));
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
      attendees: [...internalList, ...externalList],
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
                allowConflict,
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

      const json = (await res.json().catch(() => ({}))) as MeetingSaveResult & { externalSyncError?: string; invited?: number };
      const result: MeetingSaveResult = {
        id: json.id ?? initial?.meetingId ?? "",
        roomCode: json.roomCode ?? "",
        isDraft: draft,
        externalCalendarSyncStatus: json.externalCalendarSyncStatus,
        externalSyncError: json.externalSyncError,
      };

      // Keep the screen open to confirm noteworthy outcomes (guests invited,
      // sync failed); otherwise close immediately. The list refreshes either way
      // via its realtime subscription.
      const messages: string[] = [];
      if (json.invited && json.invited > 0) {
        messages.push(`invited ${json.invited} guest${json.invited === 1 ? "" : "s"} by email`);
      }
      if (json.externalSyncError) {
        messages.push(`external calendar sync failed: ${json.externalSyncError}`);
      }
      if (messages.length > 0) {
        setNotice(`Meeting saved — ${messages.join("; ")}.`);
        setSavedResult(result);
        return;
      }
      onSaved(result);
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
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-[var(--surface-1)] shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl sm:border sm:border-[var(--line)]">
        {/* Header — GCal keeps only Close (left) and a prominent Save (right). */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-[var(--fg-muted)] hover:bg-[var(--surface-0)] hover:text-[var(--fg-primary)]"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div className="flex items-center gap-2">
            {savedResult ? (
              <button
                type="button"
                onClick={() => onSaved(savedResult)}
                className="rounded-full bg-[var(--gold-400)] px-6 py-2 text-sm font-semibold text-black hover:bg-[var(--gold-500)]"
              >
                Done
              </button>
            ) : (
              <>
                {mode === "create" ? (
                  <button
                    type="button"
                    onClick={() => void submit(true)}
                    disabled={busy !== null}
                    className="rounded-full px-4 py-2 text-sm font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-0)] hover:text-[var(--fg-primary)] disabled:opacity-50"
                  >
                    {busy === "draft" ? "Saving…" : "Save draft"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void submit(false)}
                  disabled={busy !== null}
                  className="rounded-full bg-[var(--gold-400)] px-6 py-2 text-sm font-semibold text-black hover:bg-[var(--gold-500)] disabled:opacity-50"
                >
                  {busy === "save" ? "Saving…" : mode === "edit" ? "Save" : "Schedule"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {/* Borderless title — the GCal "Add title" input. */}
          <div className="pl-0 sm:pl-11">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add title"
              aria-label="Meeting title"
              className={`w-full border-0 border-b bg-transparent pb-1.5 text-2xl font-normal text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none ${
                fieldErrors.title
                  ? "border-[var(--status-danger)]"
                  : "border-transparent focus:border-[var(--gold-400)]"
              }`}
            />
            {fieldErrors.title ? <span className="text-[11px] text-[var(--status-danger)]">{fieldErrors.title}</span> : null}

            {/* Meeting type as an inline pill directly under the title. */}
            <div className="mt-3">
              <BarePill
                label="Meeting type"
                value={meetingType}
                onChange={setMeetingType}
                error={fieldErrors.meetingType}
                options={MEETING_TYPES.map((t) => ({ value: t, label: MEETING_TYPE_LABELS[t] ?? t }))}
              />
            </div>
          </div>

          {/* When — icon-led inline date/time row. */}
          <Row icon={<IconClock />} className="mt-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <BareInput type="date" value={date} onChange={setDate} ariaLabel="Date" error={Boolean(fieldErrors.date)} />
              <BareInput type="time" value={startTime} onChange={setStartTime} ariaLabel="Start time" error={Boolean(fieldErrors.startTime)} />
              <span className="text-sm text-[var(--fg-muted)]">to</span>
              <BareInput type="time" value={endTime} onChange={setEndTime} ariaLabel="End time" error={Boolean(fieldErrors.endTime)} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {DURATION_PRESETS.map((p) => (
                <Chip key={p.minutes} active={!customEnd && activeDuration === p.minutes} onClick={() => chooseDuration(p.minutes)}>
                  {p.label}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-[var(--fg-muted)]">
              {formatEndCaption(startTime, endTime, timezone)}
              {" · "}
              <button
                type="button"
                onClick={() => setAdvancedOpen(true)}
                className="underline decoration-dotted underline-offset-2 hover:text-[var(--fg-secondary)]"
              >
                Time zone
              </button>
            </p>
            {(fieldErrors.date || fieldErrors.startTime || fieldErrors.endTime) ? (
              <span className="mt-1 block text-[11px] text-[var(--status-danger)]">
                {fieldErrors.date || fieldErrors.startTime || fieldErrors.endTime}
              </span>
            ) : null}
          </Row>

          <Divider />

          {/* Two-column split: details (left) + guests (right), like GCal. */}
          <div className="grid gap-x-8 gap-y-1 md:grid-cols-[1fr_260px]">
            {/* Left — details */}
            <div className="flex flex-col">
              {/* Video conferencing — the built-in FundExecs room. No external
                  Meet/Zoom/Teams dependency; a secure room link is created on save. */}
              <Row icon={<IconVideo />}>
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2">
                  <p className="text-sm font-medium text-[var(--fg-primary)]">FundExecs video room</p>
                  <p className="text-[11px] leading-snug text-[var(--fg-muted)]">
                    A secure room link is created for this meeting when you save — no external conferencing service required.
                  </p>
                </div>
              </Row>

              <Row icon={<IconTarget />}>
                <BareTextArea value={objective} onChange={setObjective} placeholder="Objective — what outcome does this meeting need to reach?" />
              </Row>

              <Row icon={<IconNotes />}>
                <BareTextArea value={agenda} onChange={setAgenda} placeholder="Add agenda / description" />
              </Row>

              <Row icon={<IconBell />}>
                <BarePill
                  label="Notification"
                  value={reminderMinutes}
                  onChange={setReminderMinutes}
                  options={[
                    { value: "", label: "No notification" },
                    { value: "5", label: "5 minutes before" },
                    { value: "15", label: "15 minutes before" },
                    { value: "30", label: "30 minutes before" },
                    { value: "60", label: "1 hour before" },
                    { value: "1440", label: "1 day before" },
                  ]}
                />
              </Row>

              <Row icon={<IconLock />}>
                <BarePill
                  label="Visibility"
                  value={calendarVisibility}
                  onChange={setCalendarVisibility}
                  options={CALENDAR_VISIBILITIES.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))}
                />
              </Row>
            </div>

            {/* Right — guests */}
            <div className="flex flex-col gap-3 md:pl-2">
              <h3 className="text-sm font-medium text-[var(--fg-primary)]">Guests</h3>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--fg-muted)]">Internal attendees</span>
                <BareTextArea value={internalAttendees} onChange={setInternalAttendees} placeholder="Add people" rows={1} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--fg-muted)]">External guests</span>
                <BareTextArea value={externalGuests} onChange={setExternalGuests} placeholder="Jane Doe <jane@fund.com>" rows={1} />
                <span className="text-[11px] leading-snug text-[var(--fg-muted)]">Guests are invited by email on save.</span>
              </div>
            </div>
          </div>

          <Divider />

          {/* More options — collapsed by default (advanced fields). */}
          <Row icon={<IconTune />} align="start">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left"
              aria-expanded={advancedOpen}
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium text-[var(--fg-primary)]">More options</span>
                <span className="text-[11px] text-[var(--fg-muted)]">Time zone, deal linkage, copilot, prep, attachments, external calendar sync</span>
              </span>
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={`shrink-0 text-[var(--fg-muted)] transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </Row>

          {advancedOpen ? (
            <div className="pl-0 sm:pl-11">
              <div className="flex flex-col gap-6 rounded-xl border border-[var(--line)] bg-[var(--surface-0)]/40 px-4 py-5">
                <Section title="Schedule">
                  <TextField label="Time zone" required value={timezone} onChange={setTimezone} error={fieldErrors.timezone} />
                </Section>

                <Section title="Linkage & prep">
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
                  </div>
                  <TextArea label="Preparation requirements" value={preparationRequirements} onChange={setPreparationRequirements} />
                  <TextArea label="Attachments / linked documents" value={attachments} onChange={setAttachments} hint="One per line. Name <https://link> or a plain label." />
                </Section>

                <Section title="External calendar sync">
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
              </div>
            </div>
          ) : null}

          {conflicts.length > 0 ? (
            <div className="mt-4 rounded-lg border border-[var(--status-warning,#f59e0b)]/40 bg-[var(--status-warning,#f59e0b)]/10 px-3 py-3 sm:ml-11">
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

          {notice ? <p className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-xs text-[var(--fg-secondary)] sm:ml-11">{notice}</p> : null}
          {error ? <p className="mt-4 rounded-lg border border-[var(--status-danger)]/30 bg-[var(--status-danger)]/10 px-3 py-2 text-xs text-[var(--status-danger)] sm:ml-11">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

/* A GCal detail row: a leading icon gutter + free-form content. */
function Row({
  icon,
  children,
  className = "",
  align = "center",
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  align?: "center" | "start";
}) {
  return (
    <div className={`flex gap-3 py-2 ${align === "start" ? "items-start" : "items-center"} ${className}`}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-[var(--fg-muted)]">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="my-2 h-px bg-[var(--line)] sm:ml-11" />;
}

/* Bare, chrome-light input used in the GCal-style rows. */
function BareInput({
  value,
  onChange,
  type = "text",
  ariaLabel,
  placeholder,
  error,
  full,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  ariaLabel: string;
  placeholder?: string;
  error?: boolean;
  full?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <input
      ref={inputRef}
      type={type}
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border bg-[var(--surface-0)] px-3 py-1.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] ${
        full ? "w-full" : ""
      } ${error ? "border-[var(--status-danger)]" : "border-transparent hover:border-[var(--line)] focus:border-[var(--gold-400)]"}`}
    />
  );
}

/* Auto-growing bare textarea for objective / agenda / guests. */
function BareTextArea({
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-y rounded-lg border border-transparent bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] hover:border-[var(--line)] focus:border-[var(--gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
    />
  );
}

/* A compact select styled as a GCal-style pill (no floating label). */
function BarePill({
  label,
  value,
  onChange,
  options,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  error?: string;
}) {
  return (
    <label className="inline-flex flex-col gap-1">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={`rounded-lg border bg-[var(--surface-0)] px-3 py-1.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] ${
          error ? "border-[var(--status-danger)]" : "border-transparent hover:border-[var(--line)] focus:border-[var(--gold-400)]"
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">{title}</h3>
      {children}
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-[var(--gold-400)] bg-[var(--gold-400)]/15 text-[var(--gold-400)]"
          : "border-[var(--line)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

/* ── Row icons (GCal-style line icons) ─────────────────────────────────── */
const svgProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
function IconClock() {
  return (<svg {...svgProps}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>);
}
function IconVideo() {
  return (<svg {...svgProps}><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3" /></svg>);
}
function IconTarget() {
  return (<svg {...svgProps}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>);
}
function IconNotes() {
  return (<svg {...svgProps}><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="14" y2="17" /></svg>);
}
function IconBell() {
  return (<svg {...svgProps}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>);
}
function IconLock() {
  return (<svg {...svgProps}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>);
}
function IconTune() {
  return (<svg {...svgProps}><line x1="4" y1="8" x2="20" y2="8" /><circle cx="10" cy="8" r="2" /><line x1="4" y1="16" x2="20" y2="16" /><circle cx="15" cy="16" r="2" /></svg>);
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
