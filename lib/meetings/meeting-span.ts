// lib/meetings/meeting-span.ts
// When a meeting actually ran, from whatever evidence the room left behind.
//
// `live_meetings.started_at` was meant to be written by the room on entry. For
// the whole life of the product it never was (see the migration that backfills
// it), so everything downstream that wanted the real span -- the report page's
// "Length", the log's duration, the regenerate route's idea of how long the
// conversation was -- either showed nothing or quietly used the SCHEDULED
// length instead. A 64-minute call booked as 30 minutes was summarised as "ran
// twice its scheduled duration", from a number that was never measured.
//
// Pure: given what the tables hold, say when the meeting started and how long
// it ran. The routes read the rows; this decides.

/** A timestamp, or nothing: the shape every column here comes in. */
type Instant = string | null | undefined;

function ms(iso: Instant): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * When the meeting started, best evidence first.
 *
 *  1. What the room recorded, if it ever did.
 *  2. The earliest moment anyone was in the room: the first attendance row or
 *     the first transcript line, whichever is earlier.
 *  3. The end minus how long the host's browser measured the call as running,
 *     when both are known -- the room's own clock, counted back.
 *
 * Never the scheduled time: a meeting that started late started late, and the
 * one thing this must not do is invent a span that nobody measured.
 */
export function inferStartedAt(input: {
  startedAt: Instant;
  /** Earliest `live_meeting_participants.joined_at`, if any. */
  firstJoinedAt?: Instant;
  /** Earliest `live_meeting_transcripts.ts`, if any. */
  firstSpokenAt?: Instant;
  endedAt?: Instant;
  /** Seconds the host's browser counted the call as live. */
  durationSeconds?: number | null;
}): string | null {
  const recorded = ms(input.startedAt);
  if (recorded !== null) return new Date(recorded).toISOString();

  const evidence = [ms(input.firstJoinedAt), ms(input.firstSpokenAt)].filter((t): t is number => t !== null);
  if (evidence.length) return new Date(Math.min(...evidence)).toISOString();

  const ended = ms(input.endedAt);
  const seconds = input.durationSeconds;
  if (ended !== null && typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
    return new Date(ended - Math.round(seconds * 1000)).toISOString();
  }
  return null;
}

/**
 * How long the meeting ran, in seconds, for the model.
 *
 * The measured span when both ends are known and make sense; otherwise null,
 * and the model is told nothing. It used to be told the booked length, which
 * is not a duration at all -- it is what somebody hoped for a week earlier.
 */
export function meetingDurationSeconds(input: { startedAt: Instant; endedAt: Instant }): number | null {
  const start = ms(input.startedAt);
  const end = ms(input.endedAt);
  if (start === null || end === null) return null;
  const seconds = Math.round((end - start) / 1000);
  return seconds > 0 ? seconds : null;
}
