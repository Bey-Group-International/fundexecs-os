// lib/meetings/recording-timeline.ts
// Turning stored parts into something a viewer can scrub.
//
// The playback route already presents the parts as one byte stream and answers
// Range requests, which is enough to PLAY. It is not enough to seek, and the
// reason is the container rather than the transport: what MediaRecorder writes
// while a meeting is running is a live WebM. It has no duration in its header
// and no cue index, because neither can be written until the recording that is
// still being made has ended. A browser handed that shows a scrubber with no
// length and refuses to seek — and a byte offset into the middle of a WebM is
// not decodable anyway, because the header that says how to decode it lives in
// the first part.
//
// So the timeline is reconstructed here instead, from what the parts already
// know: where each one starts and how long it lasts. A seek becomes "which part
// holds this moment", which is a question about data rather than about a
// container format, and the player appends that part through MediaSource.
//
// Pure, because every off-by-one in it shows up as a video that jumps to the
// wrong minute — and because the fallback path (recordings stored before timing
// was captured) is exactly the kind of thing that is never exercised by hand.
import { CHUNK_MS } from "@/lib/meetings/recording-policy";

/** A stored part, as the database holds it. */
export interface StoredPart {
  idx: number;
  path: string;
  size: number;
  offset_ms?: number | null;
  duration_ms?: number | null;
}

/** A part placed on both the byte stream and the clock. */
export interface TimelinePart {
  idx: number;
  /** Inclusive byte offset in the assembled stream. */
  start: number;
  /** EXCLUSIVE byte offset in the assembled stream. */
  end: number;
  /** Milliseconds from the start of the recording. */
  offsetMs: number;
  durationMs: number;
}

/**
 * Place every part on the byte stream and the clock.
 *
 * Parts are taken in index order, and their byte offsets come from the sizes —
 * that arithmetic is the same one the Range route does, and it must stay the
 * same or a seek lands on a byte boundary the stream does not have.
 *
 * Timing falls back to the nominal part length wherever it was not captured.
 * That is not merely a default: it is what every recording made before timing
 * existed will use, so it has to produce a usable (if approximate) timeline
 * rather than a duration of zero.
 */
export function buildTimeline(parts: readonly StoredPart[]): TimelinePart[] {
  const ordered = [...(parts ?? [])].sort((a, b) => a.idx - b.idx);
  const out: TimelinePart[] = [];

  let byte = 0;
  let clock = 0;
  for (const part of ordered) {
    const size = Math.max(0, Math.floor(part.size ?? 0));
    const durationMs = positive(part.duration_ms) ?? CHUNK_MS;
    // A stored offset wins, because it was measured. Without one the part
    // starts where the previous one ended, which is the only thing that keeps
    // a mixed recording — some parts timed, some not — monotonic.
    const offsetMs = nonNegative(part.offset_ms) ?? clock;

    out.push({ idx: part.idx, start: byte, end: byte + size, offsetMs, durationMs });
    byte += size;
    clock = offsetMs + durationMs;
  }

  return out;
}

/** How long the whole recording runs, in milliseconds. */
export function timelineDuration(parts: readonly TimelinePart[]): number {
  if (parts.length === 0) return 0;
  return parts.reduce((end, p) => Math.max(end, p.offsetMs + p.durationMs), 0);
}

/** Total bytes of the assembled stream. */
export function timelineBytes(parts: readonly TimelinePart[]): number {
  return parts.length === 0 ? 0 : parts[parts.length - 1].end;
}

/**
 * The part holding a moment.
 *
 * Clamped rather than null-returning at both ends: a scrubber dragged past the
 * end should land on the last frame, not on an error. Returns -1 only when
 * there is nothing to play at all.
 */
export function partAtTime(parts: readonly TimelinePart[], ms: number): number {
  if (parts.length === 0) return -1;
  if (!Number.isFinite(ms) || ms <= 0) return 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (ms < part.offsetMs + part.durationMs) return i;
  }
  return parts.length - 1;
}

/**
 * The parts to append next, starting at `from`, to hold `aheadMs` of video.
 *
 * Bounded by `maxParts` as well as by time, because appending is a fetch each:
 * a player that queues four minutes of an hour-long meeting the moment somebody
 * drags the scrubber has made the seek slower than the watching.
 */
export function partsToAppend(
  parts: readonly TimelinePart[],
  from: number,
  aheadMs: number,
  maxParts = 12,
): TimelinePart[] {
  if (from < 0 || from >= parts.length) return [];
  const out: TimelinePart[] = [];
  const until = parts[from].offsetMs + Math.max(0, aheadMs);

  for (let i = from; i < parts.length && out.length < maxParts; i++) {
    out.push(parts[i]);
    if (parts[i].offsetMs + parts[i].durationMs >= until) break;
  }
  return out;
}

/**
 * The byte range covering a run of parts, as an HTTP Range header value.
 *
 * Contiguous by construction — callers append in order — so one request fetches
 * several parts rather than one request each.
 */
export function rangeHeaderFor(parts: readonly TimelinePart[]): string | null {
  if (parts.length === 0) return null;
  const start = parts[0].start;
  const end = parts[parts.length - 1].end - 1;
  return end < start ? null : `bytes=${start}-${end}`;
}

/** Milliseconds as a clock a person reads: m:ss, or h:mm:ss past an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function nonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
