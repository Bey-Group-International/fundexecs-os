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

import { subjectColumns, subjectKey, subjectOfRow, type MeetingSubject } from "@/lib/meetings/subject";

/**
 * The conflict target for the join upsert, for the kind of person joining.
 *
 * This has to name a real unique index: Postgres rejects the whole statement
 * with 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
 * specification") when it does not, and that is not a theoretical failure --
 * the join upsert spent its whole life naming a target no index matched, so
 * every attendance write in production was refused and the table stayed empty.
 *
 * There are two indexes because there are two kinds of identity and NULLs are
 * distinct in a unique index. `(meeting_id, user_id)` cannot constrain a guest
 * row, whose `user_id` is NULL -- every rejoin would insert another row, inflate
 * the head-count, and give the report two of the same person. So guests get
 * their own partial index on `(meeting_id, guest_key)`.
 *
 * Both are created by migrations and the pairs must be changed together:
 *   members -> 20260908120000_live_meeting_participants_identity.sql
 *   guests  -> 20261002200000_live_meeting_participants_guest_key.sql
 */
export function participantConflictTarget(subject: MeetingSubject): string {
  return subject.kind === "member" ? "meeting_id,user_id" : "meeting_id,guest_key";
}

/**
 * Where a guest's attendance is written, since they cannot write it themselves.
 *
 * Here rather than built at each call site because there are two -- arrival and
 * departure -- and they must agree on both the path and the query parameter.
 * The key goes in the QUERY STRING, not a body, because that is where
 * `authorizeMeetingCaller` reads it: the route checks the admission for the key
 * it is handed, so a key sent anywhere else would be authorised as one person
 * and recorded as another.
 */
export function guestAttendanceUrl(meetingId: string, guestKey: string): string {
  return `/api/meetings/${encodeURIComponent(meetingId)}/attendance?guestKey=${encodeURIComponent(guestKey)}`;
}

export interface ParticipantRow {
  meeting_id: string;
  display_name: string;
  joined_at?: string | null;
  left_at?: string | null;
  user_id?: string | null;
  guest_key?: string | null;
}

export interface AttendanceRecord {
  meeting_id: string;
  /** The account, or null for a guest who has none. */
  user_id: string | null;
  /** The key the guest's browser holds, or null for a member. */
  guest_key: string | null;
  display_name: string;
  joined_at: string;
  left_at: null;
}

/**
 * The row somebody writes when they enter the room.
 *
 * Takes a SUBJECT rather than a user id, because for most of a call's
 * participants there is no user id. This used to require one, and the `if
 * (user)` in the room's join path meant an invite-link guest wrote no row at
 * all -- so they were absent from the head-count, absent from the report, and
 * locked out of the report themselves, because `live_meeting_reports` is
 * readable by "the host OR a participant" and they were neither.
 */
export function attendanceRecord(
  meetingId: string,
  subject: MeetingSubject,
  displayName: string,
  now: Date = new Date(),
): AttendanceRecord {
  const name = displayName.trim();
  return {
    meeting_id: meetingId,
    ...subjectColumns(subject),
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

/**
 * Live head-count and names per meeting, from raw participant rows.
 *
 * One person counts once. The unique indexes make a duplicate row impossible
 * going forward, but they are per-identity and this is the number the host
 * reads off the meetings list -- so it is counted here too rather than resting
 * on the schema, which is what covers rows written before the guest index
 * existed.
 *
 * A row that names NEITHER an account nor a guest key still counts, once. It
 * cannot be de-duplicated, because nothing distinguishes it from the next row
 * like it -- but the alternative is dropping it, and that hides somebody who
 * was in the room from the count of who is in the room. Understating a
 * head-count is the worse error of the two, and the migration's
 * `live_meeting_participants_has_identity` check means the shape cannot be
 * written from here on.
 */
export function presenceByMeeting(
  rows: ParticipantRow[],
  now: number = Date.now(),
  maxNames = 8,
): Record<string, RoomPresence> {
  const map: Record<string, RoomPresence> = {};
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (!isPresent(row, now)) return;
    const subject = subjectOfRow(row);
    // An unidentifiable row gets a key of its own rather than being skipped, so
    // it is counted but can never collapse into -- or swallow -- another.
    const identity = subject ? subjectKey(subject) : `row:${index}`;
    const key = `${row.meeting_id}:${identity}`;
    if (seen.has(key)) return;
    seen.add(key);
    const entry = map[row.meeting_id] ?? (map[row.meeting_id] = { count: 0, names: [] });
    entry.count += 1;
    if (entry.names.length < maxNames) entry.names.push(row.display_name);
  });
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
  /** Attended; no report row exists yet, so one may still be coming. */
  | "generating"
  /**
   * A report exists and nobody has been waiting for it: it was written without
   * a summary.
   *
   * This is a real and reachable outcome, not an error — the report route
   * writes a row with an empty summary when the model fails, and again when a
   * one-way call had nothing to transcribe. Everything else the report holds
   * (the recording, the transcript, the chat) is still there and still worth
   * reading, which is why this is a state of its own rather than a variant of
   * "generating".
   */
  | "unsummarised"
  /**
   * Waited long enough that a report is not coming.
   *
   * Distinct from "generating" because the two want opposite treatment: one is
   * a spinner, and the other is an explanation plus a way to act.
   */
  | "stalled"
  /** Attended, and there is a report to read. */
  | "ready";

/**
 * How long a report may be "on its way" before the page stops believing it.
 *
 * DERIVED, not guessed. The report route's model call runs on a long-run
 * client: LONG_RUN_TIMEOUT_MS (120s) with maxRetries:1, so 240s of upstream
 * time in the worst case, inside a 300s function envelope. A limit shorter
 * than that declares a report dead while it is still being written — and
 * because giving up also stops the polling, the report that arrived a moment
 * later would never appear without a manual reload. So: the worst case, plus
 * room for the rest of the route and one poll interval.
 *
 * attendance.test.ts pins this against LONG_RUN_TIMEOUT_MS. It is spelled as a
 * literal rather than imported because this module is bundled into the report
 * page, and importing the Anthropic client to read one number would ship the
 * SDK to the browser.
 *
 * What it replaces is unbounded: the page polled every five seconds for as
 * long as the tab stayed open, so a report that was never coming cost twelve
 * requests a minute forever.
 */
export const REPORT_WAIT_LIMIT_MS = 360_000;

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
  /** A report ROW exists. Not the same question as whether it says anything. */
  hasReport: boolean;
  /** That row carries a summary. */
  hasSummary: boolean;
  /** Milliseconds spent waiting so far, for deciding a report is not coming. */
  waitedMs?: number;
}): ReportViewState {
  if (!input.loaded) return "loading";
  if (!input.meetingExists) return "missing";
  if (!canViewReport(input)) return "forbidden";

  // A row with a summary is the ordinary case.
  if (input.hasSummary) return "ready";

  // A row WITHOUT one is finished, not pending. Conflating the two is what put
  // a permanent spinner over every report the model could not write and every
  // one-way call nobody spoke on — while the recording and the transcript sat
  // behind it, fully readable, being polled for every five seconds forever.
  if (input.hasReport) return "unsummarised";

  return (input.waitedMs ?? 0) >= REPORT_WAIT_LIMIT_MS ? "stalled" : "generating";
}

/** Whether the page should keep polling for a report that is still being written. */
export function shouldPollReport(state: ReportViewState): boolean {
  return state === "loading" || state === "generating";
}

/** Whether this state means there is something on the page worth rendering. */
export function reportIsReadable(state: ReportViewState): boolean {
  return state === "ready" || state === "unsummarised";
}
