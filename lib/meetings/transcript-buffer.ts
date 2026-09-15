// lib/meetings/transcript-buffer.ts
// Deciding what a participant owes the database, and when.
//
// The live transcript is the only durable record a meeting leaves behind: the
// report, the institutional record and the follow-up email are all built from
// it. It used to be saved by an effect that got three things wrong at once, and
// every one of them lost words:
//
//  1. Every participant saved EVERY line. Remote lines arrive over the same
//     signaling channel and land in the same array, so a three-person meeting
//     stored each sentence three times and the report read the room stuttering.
//
//  2. The high-water mark was a POSITION in that array. Remote lines are
//     spliced in by when they were spoken, not when the packet landed, so the
//     array shifts under the mark: lines below it were never saved, and lines
//     above it were saved twice.
//
//  3. The mark advanced before the insert resolved, and the insert was
//     fire-and-forget. A write that failed took its lines with it, silently,
//     with no retry and nothing in the console.
//
// So ownership is explicit here (you save what you said, nobody else), the mark
// is a set of line ids rather than an index into a moving array, and a line
// leaves the pending set only once the database has confirmed it.
//
// Pure: no Supabase, no React, no clock beyond what is passed in. The rules are
// the part worth testing, and none of them can be exercised through a browser.

/** The part of a transcript line this module needs to decide anything. */
export interface BufferableLine {
  id: string;
  /** Signaling id of whoever spoke. */
  speakerId: string;
  speaker: string;
  /** The signed-in account behind the speaker, absent for guests. */
  userId: string | null;
  text: string;
  /** Milliseconds since the epoch. */
  ts: number;
  /** Interim results are still being revised; only settled words are saved. */
  final: boolean;
  /** This device's own words. The only ones it is responsible for. */
  isLocal: boolean;
  confidence: number;
  overlapped: boolean;
}

/** A row as `live_meeting_transcripts` stores it. */
export interface TranscriptRow {
  id: string;
  meeting_id: string;
  speaker: string;
  speaker_id: string;
  speaker_user_id: string | null;
  confidence: number;
  text: string;
  ts: string;
  overlapped: boolean;
}

/**
 * How often a live call offers its words to the database.
 *
 * Was sixty seconds, which is a long time to be holding the only copy of a
 * conversation. A meeting's last minute is where it decides things, and a
 * minute is comfortably longer than the gap between "my laptop is about to die"
 * and it dying. Fifteen seconds costs four times the requests on a path that
 * batches — a handful of rows per call — and shortens the worst case by 45
 * seconds of speech.
 */
export const FLUSH_INTERVAL_MS = 15_000;

/**
 * The most rows one flush will send.
 *
 * Bounded because the unload path posts through `fetch(..., { keepalive: true })`,
 * which browsers cap at 64KB for the whole request. Fifty utterances is far
 * inside that, and anything beyond it is a backlog that the next flush takes.
 */
export const MAX_BATCH = 50;

/**
 * Backoff between failed flushes, in milliseconds, by consecutive failure.
 *
 * A transcript flush failing usually means the network is gone, which is also
 * when the words are most worth keeping — so this backs off to relieve the
 * connection without ever giving up. The last value repeats forever.
 */
export const RETRY_BACKOFF_MS = [0, 2_000, 8_000, 30_000] as const;

/** How long to wait before the next attempt, having failed this many times. */
export function nextFlushDelay(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return FLUSH_INTERVAL_MS;
  const i = Math.min(consecutiveFailures, RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[i];
}

/**
 * The lines this device still owes the database.
 *
 * Own words only. A remote line is somebody else's to save — they have it in
 * their own buffer, under their own name, and both of us writing it is how the
 * same sentence ended up in the report three times. The cost of that rule is
 * that a participant who closes their laptop mid-sentence takes their last
 * unflushed words with them; the alternative costs every sentence of every
 * meeting, every time.
 *
 * Interim lines are excluded: they are a live caption of a sentence still being
 * revised, and the final result replaces them.
 */
export function pendingLines<T extends BufferableLine>(
  lines: readonly T[],
  saved: ReadonlySet<string>,
): T[] {
  return lines.filter((l) => l.final && l.isLocal && !saved.has(l.id));
}

/**
 * The next batch to send, oldest first.
 *
 * Oldest first so that a call that never catches up still saves the meeting in
 * order, and so a cap that bites drops the newest words rather than the record
 * of how the conversation got there.
 */
export function nextBatch<T extends BufferableLine>(
  pending: readonly T[],
  max: number = MAX_BATCH,
): T[] {
  return [...pending].sort((a, b) => a.ts - b.ts).slice(0, Math.max(0, max));
}

/**
 * Turn lines into rows.
 *
 * The line's own id becomes the row's primary key, which is what makes a retry
 * safe: the same flush sent twice conflicts on the second and stores nothing
 * new. Everything the report needs to render the line is carried, including
 * `overlapped` — without it a rebuilt line can say it is doubtful but not that
 * two people were talking at once.
 */
export function transcriptRows(
  lines: readonly BufferableLine[],
  meetingId: string,
): TranscriptRow[] {
  return lines.map((l) => ({
    id: l.id,
    meeting_id: meetingId,
    speaker: l.speaker,
    speaker_id: l.speakerId,
    speaker_user_id: l.userId,
    confidence: l.confidence,
    text: l.text,
    ts: new Date(l.ts).toISOString(),
    overlapped: l.overlapped,
  }));
}

/** Whether a flush is worth making at all. */
export function shouldFlush(pending: readonly BufferableLine[]): boolean {
  return pending.length > 0;
}

/**
 * Everyone the report should be told about, in the order they first spoke.
 *
 * The report model was being handed "Participants: Unknown" on every live
 * meeting this product has ever ended — `endMeeting` posted a transcript and
 * nothing else — while its own system prompt asks it to assign action items to
 * named people. It had the names inside the transcript and no confirmation that
 * they were people rather than something it had misread.
 *
 * Built from who actually spoke, then topped up with anyone still in the room
 * who did not. A silent attendee belongs in the list: "nobody from legal said
 * anything" is a different meeting from "nobody from legal was there".
 */
export function speakerNames(
  lines: readonly BufferableLine[],
  alsoPresent: readonly string[] = [],
): string[] {
  const seen: string[] = [];
  const add = (raw: string) => {
    const name = raw.trim();
    if (name && !seen.includes(name)) seen.push(name);
  };
  for (const line of [...lines].sort((a, b) => a.ts - b.ts)) {
    if (line.final) add(line.speaker);
  }
  for (const name of alsoPresent) add(name);
  return seen;
}
