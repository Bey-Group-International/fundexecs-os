// lib/meetings/attendance.ts
// Who was actually in the room, and what that entitles them to see.
//
// Distinct from lib/meetings/attendees.ts, which is the *invite* list stored on
// live_meetings.attendees. This file is about live_meeting_participants: the
// row written when someone crosses the threshold into the call.
//
// Pure: no supabase client, no DOM. The queries belong to the callers so these
// rules — one row per person per meeting, when a row still means "in the room",
// who may read a report — can be tested without a database.

/**
 * The conflict target for the join upsert.
 *
 * This has to name a real unique constraint: Postgres rejects the whole
 * statement with 42P10 ("no unique or exclusion constraint matching the ON
 * CONFLICT specification") when it does not, and a fire-and-forget upsert makes
 * that failure invisible. The constraint is created in
 * 20260908120000_live_meeting_participants_identity.sql; the two must be
 * changed together.
 */
export const PARTICIPANT_CONFLICT_TARGET = "meeting_id,user_id";

export interface ParticipantRow {
  meeting_id: string;
  display_name: string;
  joined_at?: string | null;
  left_at?: string | null;
}

export interface AttendanceRecord {
  meeting_id: string;
  user_id: string;
  display_name: string;
  joined_at: string;
  left_at: null;
}

/** The row a member writes when they enter the room. */
export function attendanceRecord(
  meetingId: string,
  userId: string,
  displayName: string,
  now: Date = new Date(),
): AttendanceRecord {
  const name = displayName.trim();
  return {
    meeting_id: meetingId,
    user_id: userId,
    // A blank name would render as an empty chip in the participant strip and
    // an empty line in the report's attendance list.
    display_name: name || "Guest",
    joined_at: now.toISOString(),
    // Re-entering a room clears the earlier departure: the upsert overwrites,
    // so without this a rejoin would keep the stale left_at and the member
    // would be recorded as having left while they are sitting in the call.
    left_at: null,
  };
}

/**
 * How long a row with no left_at is still believed.
 *
 * Departure is written on leave, on end, and on pagehide, but a killed tab, a
 * lost laptop or a crashed renderer writes nothing at all. Without a ceiling
 * those rows say "in the room" forever, and the head-count on the meetings list
 * only ever grows.
 */
export const PRESENCE_STALE_MS = 4 * 60 * 60 * 1000;

/** Whether a participant row still means "in the room right now". */
export function isPresent(row: ParticipantRow, now: number = Date.now()): boolean {
  if (row.left_at) return false;
  if (!row.joined_at) return true;
  const joined = new Date(row.joined_at).getTime();
  // An unparseable timestamp is not evidence of absence.
  if (!Number.isFinite(joined)) return true;
  return now - joined < PRESENCE_STALE_MS;
}

export interface RoomPresence {
  count: number;
  names: string[];
}

/** Live head-count and names per meeting, from raw participant rows. */
export function presenceByMeeting(
  rows: ParticipantRow[],
  now: number = Date.now(),
  maxNames = 8,
): Record<string, RoomPresence> {
  const map: Record<string, RoomPresence> = {};
  for (const row of rows) {
    if (!isPresent(row, now)) continue;
    const entry = map[row.meeting_id] ?? (map[row.meeting_id] = { count: 0, names: [] });
    entry.count += 1;
    if (entry.names.length < maxNames) entry.names.push(row.display_name);
  }
  return map;
}

/**
 * The meeting ids someone attended but did not host.
 *
 * Both callers of this fetched every participant row for the member and then
 * subtracted the hosted ids by scanning an array inside a filter — quadratic,
 * and duplicated in two files that had already drifted apart in their limits.
 */
export function attendedButNotHosted(
  participantMeetingIds: string[],
  hostedMeetingIds: string[],
): string[] {
  const hosted = new Set(hostedMeetingIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of participantMeetingIds) {
    if (!id || hosted.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Whether the viewer is entitled to a meeting's report.
 *
 * Reports are attendees-only, enforced in Postgres by the
 * live_meeting_reports_meeting policy (host OR a participant row). This mirrors
 * that rule in the client so the page can *say so*, because RLS on its own is
 * indistinguishable from "the report does not exist yet".
 */
export function canViewReport(state: {
  hostId: string | null;
  viewerId: string | null;
  attended: boolean;
}): boolean {
  if (!state.viewerId) return false;
  return state.attended || state.hostId === state.viewerId;
}

export type ReportViewState =
  /** Still fetching. */
  | "loading"
  /** No such meeting, or not visible to this member's organisation. */
  | "missing"
  /** The meeting exists, but the viewer was not in it. */
  | "forbidden"
  /** Attended; the report has not been written (or summarised) yet. */
  | "generating"
  /** Attended, and there is a report to read. */
  | "ready";

/**
 * What the report page should show.
 *
 * The order is the whole point. "forbidden" has to be decided before
 * "generating", because a non-attendee reads a report row of null under RLS —
 * exactly what a report still being written looks like. Deciding "generating"
 * first is what left everyone but the host polling a spinner forever.
 */
export function reportViewState(input: {
  loaded: boolean;
  meetingExists: boolean;
  hostId: string | null;
  viewerId: string | null;
  attended: boolean;
  hasSummary: boolean;
}): ReportViewState {
  if (!input.loaded) return "loading";
  if (!input.meetingExists) return "missing";
  if (!canViewReport(input)) return "forbidden";
  return input.hasSummary ? "ready" : "generating";
}

/** Whether the page should keep polling for a report that is still being written. */
export function shouldPollReport(state: ReportViewState): boolean {
  return state === "loading" || state === "generating";
}
