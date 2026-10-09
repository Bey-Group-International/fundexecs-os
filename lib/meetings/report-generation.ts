// lib/meetings/report-generation.ts
// The rules every path that writes a meeting report has to agree on.
//
// A report is written from four places now: the room when the host presses
// End, the regenerate button, the hourly sweep that closes meetings nobody
// ended, and — indirectly — the retry the room makes when its first attempt
// lost its response. Each of those used to carry its own copy of the small
// decisions below, and the copies had already drifted: the end route named
// participants from the room's peer list while the regenerate route named them
// from the invite list, so the same meeting's two reports disagreed about who
// was in it.
//
// Pure: no database, no model, no clock of its own.

import type { TranscriptVerdict } from "@/lib/meetings/transcript-quality";
import { parseTranscript } from "@/lib/meetings/transcript-view";
import { EMPTY_REPORT } from "@/lib/meetings/report-analysis";

// ── Idempotency ─────────────────────────────────────────────────────────────

/**
 * How recently a report must have been written for a second request to be
 * treated as the same press of End.
 *
 * The room posts the transcript and waits on the response. On a slow model
 * call the browser's own fetch can give up, or the host can reload, or the
 * retry state can be pressed — and each of those posts the same transcript
 * again to a meeting that is already ended with a report already on file. The
 * second run cost a second model call, wrote a second report row, raised the
 * action items a second time and dated the meeting's end to the retry.
 *
 * Two minutes is long enough to cover a retry made because the first response
 * was lost, and short enough that a host who genuinely wants a fresh version
 * ten minutes later still gets one through the versions path.
 */
export const REPORT_FRESH_MS = 2 * 60_000;

/** Whether a report written at `createdAt` is recent enough to answer for a repeat request. */
export function isFreshReport(createdAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!createdAt) return false;
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return false;
  return now - ms >= 0 && now - ms < REPORT_FRESH_MS;
}

// ── A report with nothing in it, on purpose ─────────────────────────────────

/**
 * On `analysis`: why a report row was written without asking the model.
 *
 * Kept on the blob next to `report_truncated` and `correction_note` rather
 * than in a column, for the reason those are: a report row is then the same
 * shape whether or not a migration has reached the database.
 */
export const UNSUMMARISED_KEY = "unsummarised";

/**
 * The two reasons a transcript is not worth a model call, in the verdict's
 * own words: nothing was heard at all, or what was heard was noise.
 */
export type UnsummarisedReason = "silent" | "unusable";

/**
 * Whether this transcript should be filed without a summary.
 *
 * Gated on the quality verdict and nothing else, because the verdict already
 * encodes the judgement: a short clean meeting is "usable", and a long one
 * whose lines the engine scored as noise is "unusable". Asking the model about
 * the second kind produced, at best, an apology — and on another day a
 * confident summary of decisions nobody made.
 */
export function unsummarisedReasonFor(verdict: TranscriptVerdict): UnsummarisedReason | null {
  if (verdict === "silent") return "silent";
  if (verdict === "unusable") return "unusable";
  return null;
}

/** The analysis blob an unsummarised report row carries. */
export function unsummarisedAnalysis(reason: UnsummarisedReason): Record<string, unknown> {
  return { ...EMPTY_REPORT, [UNSUMMARISED_KEY]: reason };
}

/** The reason a stored report was left unsummarised, or null for every other report. */
export function unsummarisedReason(analysis: Record<string, unknown> | null | undefined): UnsummarisedReason | null {
  const value = analysis?.[UNSUMMARISED_KEY];
  return value === "silent" || value === "unusable" ? value : null;
}

/**
 * What the page and the export say where the summary would have been.
 *
 * One sentence for both reasons: to the reader the difference between "no
 * speech" and "speech the engine could not score" is not actionable, and the
 * transcript — kept in full either way — is where they would look for it.
 */
export const NOTHING_TO_SUMMARISE = "Nothing to summarise: no usable speech was captured.";

// ── Who was in the meeting ──────────────────────────────────────────────────

/**
 * The people the report names, built the same way everywhere.
 *
 * Attendance rows and the transcript's own speakers, with the host first.
 * NOT the invite list: for an instant meeting that list is empty, and for a
 * scheduled one it names people who may never have joined. A report that
 * lists an absent invitee as a participant then has the model assigning them
 * action items from a meeting they were not in.
 *
 * `extra` is for a caller holding names the tables may not: the room's own
 * peer list at the moment End was pressed, which survives an attendance write
 * that failed. De-duplicated case-insensitively because the same person
 * arrives as "ana lopez" from a join screen and "Ana Lopez" from the directory.
 */
export function participantNamesForReport(input: {
  host?: { name?: string | null } | null;
  present?: ReadonlyArray<{ name: string }> | null;
  transcript?: string | null;
  extra?: ReadonlyArray<string> | null;
}): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (raw: unknown) => {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };

  add(input.host?.name);
  for (const person of input.present ?? []) add(person?.name);
  for (const speaker of speakerNames(input.transcript ?? "")) add(speaker);
  for (const name of input.extra ?? []) add(name);
  return names;
}

/**
 * Every distinct speaker label in a rendered transcript, in order of first
 * appearance.
 *
 * Through `parseTranscript`, so a line's confidence note — "Ana (uncertain —
 * not recognised reliably): …" — is read as a note and not as a second person
 * called "Ana (uncertain". The label "You" is dropped: it is what the local
 * line carried before lines were stamped with the member's display name, and
 * it names nobody.
 */
export function speakerNames(transcript: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const turn of parseTranscript(transcript)) {
    const name = turn.speaker.trim();
    if (!name || name.toLowerCase() === "you") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// ── Meetings nobody ended ───────────────────────────────────────────────────

/**
 * How long a meeting may sit `active` or `waiting` with no sign of life before
 * the sweep closes it.
 *
 * Shorter than the four-hour presence ceiling, deliberately: that one decides
 * whether a participant row still means "in the room", and errs long because
 * overstating a head-count is cheap. This decides whether to spend a model call
 * and write the record, and three hours of silence after the last person left
 * is not a meeting still in progress.
 */
export const STALE_MEETING_MS = 3 * 60 * 60 * 1000;

/** The evidence the sweep reads about a meeting that was never ended. */
export interface MeetingActivity {
  status: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  created_at: string;
  /** Latest `live_meeting_participants.joined_at`, if anyone ever joined. */
  lastJoinedAt?: string | null;
  /** Latest `live_meeting_participants.left_at`, if anyone ever left. */
  lastLeftAt?: string | null;
  /** Latest `live_meeting_transcripts.ts`, if anything was ever heard. */
  lastSpokenAt?: string | null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * The last moment anything happened in this meeting, or null when nothing
 * ever did.
 *
 * Null is the important answer. A scheduled meeting is `waiting` from the day
 * it is booked, and a sweep that read `created_at` as activity would close
 * next week's board call three hours after somebody put it in the calendar.
 * So `created_at` only counts once the room shows evidence of having opened:
 * the status moved to active, a start was recorded, or somebody joined or
 * spoke.
 */
export function lastActivityAt(meeting: MeetingActivity): number | null {
  const evidence = [
    ms(meeting.lastLeftAt),
    ms(meeting.lastJoinedAt),
    ms(meeting.lastSpokenAt),
    ms(meeting.started_at),
  ].filter((t): t is number => t !== null);

  if (evidence.length) return Math.max(...evidence);
  // A room marked active opened, even if nothing else was written about it.
  if (meeting.status === "active") return ms(meeting.created_at);
  return null;
}

/**
 * Whether the sweep should close this meeting now.
 *
 * Three conditions, all required: the meeting is not already ended; it showed
 * signs of life and the last of them is older than the ceiling; and, when it
 * was booked for a time, that time is also past the ceiling — a room a host
 * opened early to test their camera is not abandoned because the meeting is
 * still an hour away.
 */
export function isAbandonedMeeting(meeting: MeetingActivity, now: number = Date.now()): boolean {
  if (meeting.status === "ended") return false;
  const last = lastActivityAt(meeting);
  if (last === null) return false;
  if (now - last < STALE_MEETING_MS) return false;
  const scheduled = ms(meeting.scheduled_at);
  if (scheduled !== null && now - scheduled < STALE_MEETING_MS) return false;
  return true;
}

// ── Sending the summary ─────────────────────────────────────────────────────

/**
 * Whether a request to email the summary should be refused as a repeat.
 *
 * The send button had no memory. A host who did not see the confirmation —
 * or saw it and pressed again to be sure — mailed every attendee a second
 * copy, and the inbox recorded a second thread per person. The meeting row now
 * remembers the first send, and a second press is answered with when it went
 * rather than with another round of mail, unless the host says `resend`.
 */
export function summaryAlreadySent(input: { sentAt: string | null | undefined; resend?: boolean }): boolean {
  if (input.resend === true) return false;
  return typeof input.sentAt === "string" && Number.isFinite(Date.parse(input.sentAt));
}
