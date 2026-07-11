// lib/meetings/schedule.ts
// Pure logic for the institutional Schedule Meeting flow: validation of the
// Meeting Edit Screen, meeting-status derivation, conflict detection, and the
// external (third-party) calendar sync state machine.
//
// Everything here is side-effect free so it can be unit tested and shared
// between the API layer, the service layer, and the client UI.

export const MEETING_TYPES = [
  "internal_strategy",
  "investor_update",
  "lp_review",
  "deal_review",
  "diligence",
  "portfolio_review",
  "board_meeting",
  "external_pitch",
  "advisory",
  "other",
] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const CALENDAR_VISIBILITIES = ["private", "team", "organization", "public"] as const;
export type CalendarVisibility = (typeof CALENDAR_VISIBILITIES)[number];

export const RELATED_RECORD_TYPES = ["fund", "deal", "company", "investor", "workspace"] as const;
export type RelatedRecordType = (typeof RELATED_RECORD_TYPES)[number];

export const EXTERNAL_CALENDAR_PROVIDERS = ["google_calendar", "outlook", "calendly", "ical"] as const;
export type ExternalCalendarProvider = (typeof EXTERNAL_CALENDAR_PROVIDERS)[number];

// UI-facing external calendar sync status machine.
export const EXTERNAL_SYNC_STATUSES = [
  "not_connected",
  "sync_off",
  "sync_pending",
  "synced",
  "sync_failed",
  "needs_resync",
] as const;
export type ExternalSyncStatus = (typeof EXTERNAL_SYNC_STATUSES)[number];

export const EXTERNAL_SYNC_STATUS_LABELS: Record<ExternalSyncStatus, string> = {
  not_connected: "Not Connected",
  sync_off: "Sync Off",
  sync_pending: "Sync Pending",
  synced: "Synced",
  sync_failed: "Sync Failed",
  needs_resync: "Needs Re-Sync",
};

// Meeting lifecycle status shown on the Upcoming Meetings card. Derived from the
// underlying room status + prep/follow-up state rather than stored directly, so
// the room lifecycle (waiting/active/ended) stays the single source of truth.
export type MeetingDisplayStatus =
  | "Scheduled"
  | "Prep Needed"
  | "Ready"
  | "Updated"
  | "Live"
  | "Completed"
  | "Follow-Up Needed";

export const REQUIRED_FIELDS = [
  "title",
  "meetingType",
  "date",
  "startTime",
  "endTime",
  "timezone",
] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export interface MeetingDraftInput {
  title?: string | null;
  meetingType?: string | null;
  /** Local calendar date, YYYY-MM-DD. */
  date?: string | null;
  /** Local start time, HH:mm. */
  startTime?: string | null;
  /** Local end time, HH:mm. */
  endTime?: string | null;
  timezone?: string | null;
}

export type FieldErrors = Partial<Record<RequiredField, string>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * Field-level validation for a Save Meeting attempt. Returns a map of the
 * required fields that are missing or invalid. An empty object means valid.
 */
export function validateMeetingDraft(input: MeetingDraftInput): FieldErrors {
  const errors: FieldErrors = {};

  if (!input.title || !input.title.trim()) {
    errors.title = "Meeting title is required.";
  }
  if (!input.meetingType || !input.meetingType.trim()) {
    errors.meetingType = "Meeting type is required.";
  }
  if (!input.date || !DATE_RE.test(input.date)) {
    errors.date = "A valid date is required.";
  }
  if (!input.startTime || !TIME_RE.test(input.startTime)) {
    errors.startTime = "A valid start time is required.";
  }
  if (!input.endTime || !TIME_RE.test(input.endTime)) {
    errors.endTime = "A valid end time is required.";
  }
  if (!input.timezone || !input.timezone.trim()) {
    errors.timezone = "A time zone is required.";
  }

  // End must be after start when both are present and well formed.
  if (!errors.startTime && !errors.endTime && input.startTime && input.endTime) {
    if (minutesOfDay(input.endTime) <= minutesOfDay(input.startTime)) {
      errors.endTime = "End time must be after start time.";
    }
  }

  return errors;
}

export function isValidDraft(input: MeetingDraftInput): boolean {
  return Object.keys(validateMeetingDraft(input)).length === 0;
}

function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Duration in minutes between two HH:mm times on the same day. */
export function durationMinutesFromTimes(startTime: string, endTime: string): number {
  return minutesOfDay(endTime) - minutesOfDay(startTime);
}

/**
 * Combine a local date + time into an ISO instant, interpreting the wall-clock
 * time in the given IANA time zone. Falls back to the environment's local zone
 * math when Intl data is unavailable for the zone.
 */
export function localToIso(date: string, time: string, timezone: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  // Instant that has these Y/M/D H:M numbers when read in UTC.
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  // Two-pass offset resolution: the offset sampled at `asUtc` can differ from the
  // offset at the actual resulting instant near a DST transition, so refine once
  // at the candidate instant. This corrects the ~1h error for times scheduled
  // within an hour of a spring-forward / fall-back boundary.
  const firstOffset = timezoneOffsetMs(new Date(asUtc), timezone);
  const offset = timezoneOffsetMs(new Date(asUtc - firstOffset), timezone);
  return new Date(asUtc - offset).toISOString();
}

/** Offset (ms) of a zone at an instant: (wall clock in zone) - UTC. */
function timezoneOffsetMs(instant: Date, timezone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(instant);
    const map: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== "literal") map[p.type] = Number(p.value);
    }
    // Some Intl implementations render midnight as hour "24"; pass it straight to
    // Date.UTC, which normalizes 24:00 to 00:00 of the following day (mapping it to
    // 0 without rolling the day would skew the offset by ~24h).
    const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
    return asUtc - instant.getTime();
  } catch {
    return 0;
  }
}

export interface ScheduledMeetingShape {
  status?: string | null; // room lifecycle: waiting | active | ended
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  preparation_status?: string | null;
  followup_status?: string | null;
  locked_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

/**
 * Derive the Upcoming Meetings card status from a persisted meeting row.
 * Priority reflects the real-world lifecycle:
 *  active room               -> Live
 *  ended room, follow-up open -> Follow-Up Needed
 *  ended room                 -> Completed
 *  edited after save          -> Updated
 *  prep still needed          -> Prep Needed
 *  prep ready                 -> Ready
 *  otherwise                  -> Scheduled
 */
export function deriveMeetingStatus(
  meeting: ScheduledMeetingShape,
  now: number = Date.now(),
): MeetingDisplayStatus {
  const status = meeting.status ?? "waiting";

  if (status === "active") return "Live";
  if (status === "ended") {
    return meeting.followup_status && meeting.followup_status !== "not_started" && meeting.followup_status !== "done"
      ? "Follow-Up Needed"
      : "Completed";
  }

  // Meeting whose end time has passed but the room was never ended.
  if (meeting.scheduled_at) {
    const end = new Date(meeting.scheduled_at).getTime() + (meeting.duration_minutes ?? 60) * 60_000;
    if (end < now) {
      return meeting.followup_status && meeting.followup_status !== "not_started" && meeting.followup_status !== "done"
        ? "Follow-Up Needed"
        : "Completed";
    }
  }

  if (meeting.locked_at && meeting.updated_at && wasEditedAfterSave(meeting)) {
    return "Updated";
  }

  if (meeting.preparation_status === "ready") return "Ready";
  if (meeting.preparation_status === "prep_needed") return "Prep Needed";
  return "Scheduled";
}

/**
 * Whether a meeting belongs in the "Past" list: it has ended, OR its scheduled
 * end time is already in the past. Future / in-progress meetings and drafts are
 * NOT past — this mirrors the Upcoming partition so a meeting lands in exactly
 * one list (an ad-hoc room with no scheduled time is only "past" once ended).
 */
export function isPastMeeting(
  meeting: Pick<ScheduledMeetingShape, "status" | "scheduled_at" | "duration_minutes"> & { is_draft?: boolean | null },
  now: number = Date.now(),
): boolean {
  if (meeting.is_draft) return false;
  if (meeting.status === "ended") return true;
  if (meeting.scheduled_at) {
    const end = new Date(meeting.scheduled_at).getTime() + (meeting.duration_minutes ?? 60) * 60_000;
    return end < now;
  }
  return false;
}

/** True when updated_at is meaningfully after locked_at (a deliberate edit). */
export function wasEditedAfterSave(meeting: ScheduledMeetingShape): boolean {
  if (!meeting.locked_at || !meeting.updated_at) return false;
  return new Date(meeting.updated_at).getTime() - new Date(meeting.locked_at).getTime() > 1000;
}

// ── Real-time countdown / live-window state ────────────────────────────────
// Pure derivation of a meeting's position relative to "now" so the Upcoming
// Meetings cards can tick live (countdown, "In Progress", "Ended") without a
// server round-trip. The room lifecycle (started_at/ended_at) remains the
// source of truth for *liveness*; this only reasons about the scheduled window.

export type MeetingTimePhase = "upcoming" | "imminent" | "in_progress" | "ended";

export interface MeetingTimeState {
  phase: MeetingTimePhase;
  /** Short human label, e.g. "in 12 min", "Starts now", "24 min left", "Ended". */
  label: string;
  /** Whole minutes until start (negative once started). */
  minutesToStart: number;
}

const MINUTE = 60_000;

/** Pluralize a whole-unit count: relativeUnits(1,"min") -> "1 min". */
function relativeUnits(value: number, unit: "min" | "hour" | "day"): string {
  const abbrev = unit === "min" ? "min" : unit === "hour" ? "hr" : "day";
  return `${value} ${abbrev}${value === 1 ? "" : "s"}`;
}

/** Turn a signed millisecond gap into a compact "12 min" / "3 hrs" / "2 days". */
function humanizeGap(ms: number): string {
  const mins = Math.round(Math.abs(ms) / MINUTE);
  if (mins < 60) return relativeUnits(Math.max(mins, 1), "min");
  const hours = Math.round(mins / 60);
  if (hours < 24) return relativeUnits(hours, "hour");
  return relativeUnits(Math.round(hours / 24), "day");
}

/**
 * Derive the live scheduling state of a meeting relative to `now`.
 * - `imminent` fires inside the last two minutes before start so the UI can
 *   switch to an urgent "Starts now" affordance.
 * - `in_progress` spans [start, start + duration).
 */
export function meetingTimeState(
  scheduledAt: string | null | undefined,
  durationMinutes: number | null | undefined,
  now: number = Date.now(),
): MeetingTimeState | null {
  if (!scheduledAt) return null;
  const start = new Date(scheduledAt).getTime();
  if (!Number.isFinite(start)) return null;
  const end = start + (durationMinutes ?? 60) * MINUTE;
  const minutesToStart = Math.round((start - now) / MINUTE);

  if (now >= end) {
    return { phase: "ended", label: "Ended", minutesToStart };
  }
  if (now >= start) {
    const left = humanizeGap(end - now);
    return { phase: "in_progress", label: `${left} left`, minutesToStart };
  }
  if (start - now <= 2 * MINUTE) {
    return { phase: "imminent", label: "Starts now", minutesToStart };
  }
  return { phase: "upcoming", label: `in ${humanizeGap(start - now)}`, minutesToStart };
}

export interface ConflictCandidate {
  id: string;
  title?: string | null;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  /** Host + attendees, used to scope a conflict to a shared person. */
  host_id?: string | null;
  attendees?: unknown;
}

export interface MeetingConflict {
  id: string;
  title: string;
  scheduledAt: string;
}

/** Lowercased, de-duped attendee emails from a meeting's attendees JSON. */
function attendeeEmails(attendees: unknown): string[] {
  if (!Array.isArray(attendees)) return [];
  const out: string[] = [];
  for (const a of attendees) {
    const email = a && typeof a === "object" ? (a as { email?: unknown }).email : null;
    if (typeof email === "string" && email.trim()) out.push(email.trim().toLowerCase());
  }
  return out;
}

/**
 * Build the set of identity keys for a meeting — its host and attendee emails —
 * so two meetings can be compared for a shared person. Host ids and emails are
 * namespaced (`u:` / `e:`) so a UUID can never collide with an email.
 */
export function meetingIdentityKeys(opts: {
  hostId?: string | null;
  emails?: Array<string | null | undefined>;
}): Set<string> {
  const keys = new Set<string>();
  if (opts.hostId) keys.add(`u:${opts.hostId}`);
  for (const e of opts.emails ?? []) {
    if (e && e.trim()) keys.add(`e:${e.trim().toLowerCase()}`);
  }
  return keys;
}

export interface ConflictOptions {
  /** Skip this meeting id (the one being scheduled/edited). */
  excludeId?: string | null;
  /**
   * When provided, a time overlap only counts as a conflict if the candidate
   * shares this host or one of these attendee emails — i.e. an actual person is
   * double-booked. Omit both to fall back to a plain org-wide time overlap.
   */
  subjectHostId?: string | null;
  subjectEmails?: Array<string | null | undefined>;
}

/**
 * Detect meetings whose time window overlaps [startIso, endIso). When
 * `subjectHostId`/`subjectEmails` are supplied, overlaps are scoped to meetings
 * that share a participant with the meeting being scheduled; otherwise any time
 * overlap is returned. `excludeId` skips the meeting being edited.
 *
 * A fourth string argument is still accepted as a shorthand for `excludeId` for
 * backward compatibility.
 */
export function findConflicts(
  candidates: ConflictCandidate[],
  startIso: string,
  endIso: string,
  options?: ConflictOptions | string | null,
): MeetingConflict[] {
  const opts: ConflictOptions =
    typeof options === "string" || options == null ? { excludeId: options ?? null } : options;

  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  const subjectKeys = meetingIdentityKeys({ hostId: opts.subjectHostId, emails: opts.subjectEmails });
  const scoped = subjectKeys.size > 0;

  const conflicts: MeetingConflict[] = [];
  for (const c of candidates) {
    if (!c.scheduled_at) continue;
    if (opts.excludeId && c.id === opts.excludeId) continue;
    const cStart = new Date(c.scheduled_at).getTime();
    if (!Number.isFinite(cStart)) continue;
    const cEnd = cStart + (c.duration_minutes ?? 60) * 60_000;
    // Overlap when neither ends before the other starts.
    if (!(cStart < end && cEnd > start)) continue;

    // Scoped mode: an overlap only conflicts if a person is on both meetings.
    if (scoped) {
      const candidateKeys = meetingIdentityKeys({ hostId: c.host_id, emails: attendeeEmails(c.attendees) });
      let shares = false;
      for (const k of candidateKeys) {
        if (subjectKeys.has(k)) { shares = true; break; }
      }
      if (!shares) continue;
    }

    conflicts.push({ id: c.id, title: c.title ?? "Meeting", scheduledAt: c.scheduled_at });
  }
  return conflicts;
}

/**
 * Resolve the external sync status when the user saves/edits a meeting.
 * - Sync disabled          -> not_connected / sync_off
 * - Enabled, first save     -> sync_pending
 * - Enabled, later edit      -> needs_resync (was synced) / sync_pending
 */
export function nextExternalSyncStatus(opts: {
  enabled: boolean;
  providerConnected: boolean;
  currentStatus?: ExternalSyncStatus | null;
  isEdit: boolean;
  timingOrAttendeesChanged: boolean;
}): ExternalSyncStatus {
  if (!opts.providerConnected) return "not_connected";
  if (!opts.enabled) return "sync_off";

  if (opts.isEdit) {
    if (opts.currentStatus === "synced") {
      return opts.timingOrAttendeesChanged ? "needs_resync" : "synced";
    }
    return "sync_pending";
  }
  return "sync_pending";
}
