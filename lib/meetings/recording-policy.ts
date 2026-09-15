// lib/meetings/recording-policy.ts
// What a recording costs, what it is called, and how long it is kept.
//
// The call is a MESH: every participant sends to every other participant and
// there is no server in the middle holding the media. Nothing but a browser
// ever sees all of the streams at once, so nothing but a browser can record
// them — and the only browser guaranteed to be in the room for the whole
// meeting, and entitled to the result, is the host's.
//
// That decision has a cost the rest of this module exists to bound. The host's
// machine is already decoding N video streams and encoding its own; recording
// adds compositing every frame and encoding the composite. Get the numbers
// wrong and the recording degrades the call it is recording, which is the one
// outcome nobody would accept.
//
// Pure: no MediaRecorder, no canvas, no Supabase. Settings and naming only.

/**
 * Capture size. 720p, not 1080p.
 *
 * Legible for faces and for most shared slides, and a quarter of the pixels to
 * composite and encode per frame compared with 1080p. On a host who is also
 * running the call, that difference is the difference between a recording
 * nobody notices and a call that stutters while it is being recorded.
 */
export const RECORDING_WIDTH = 1280;
export const RECORDING_HEIGHT = 720;

/**
 * Frames per second.
 *
 * 24 rather than 30: a meeting is talking heads and slides, not motion, and the
 * saving is a fifth of every per-frame cost — the composite draw, the encode,
 * and the bytes.
 */
export const RECORDING_FPS = 24;

/** ~1.5 Mbps video + 128 kbps audio ≈ 675 MB per hour. */
export const VIDEO_BITRATE = 1_500_000;
export const AUDIO_BITRATE = 128_000;

/**
 * How much speech one uploaded part holds.
 *
 * This is the granularity of what survives a crash, so it wants to be small;
 * it is also one storage object and one request each, so it does not want to
 * be tiny. Five seconds is about 940KB at the bitrates above — comfortably
 * inside every request limit on the path — and means a host whose laptop dies
 * loses at most the last five seconds of the meeting.
 */
export const CHUNK_MS = 5_000;

/**
 * How long recordings are kept before the sweep deletes them.
 *
 * Ninety days covers the window in which anyone actually rewatches a call,
 * and puts a floor under the storage bill that does not depend on anybody
 * remembering to tidy up. Deletion is the default; a recording worth keeping
 * longer is a feature that can be added against a real request.
 */
export const RETENTION_DAYS = 90;

/** The private bucket. Never public: a recording is the most sensitive artifact a meeting produces. */
export const RECORDING_BUCKET = "meeting-recordings";

/**
 * Codecs to try, best first.
 *
 * VP9 first because it is roughly 30% smaller than VP8 at the same quality and
 * every browser that can record it can play it. VP8 is the fallback that has
 * worked everywhere for a decade. The bare `video/webm` entry is there for a
 * browser that supports recording but reports nothing specific rather than
 * leaving the host with no recording at all.
 *
 * Safari records MP4 and not WebM, so its entry is last and separate: it plays
 * everywhere too, but H.264 encoding on a machine already running a call is
 * the most expensive option here, and it should only be reached by a browser
 * with no alternative.
 */
export const CODEC_PREFERENCE = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
] as const;

/**
 * The first codec this browser will actually record.
 *
 * Takes the support test as an argument rather than calling
 * `MediaRecorder.isTypeSupported` itself, so the preference order can be tested
 * without a browser — which is the only way it ever gets tested at all.
 */
export function preferredMimeType(isSupported: (type: string) => boolean): string | null {
  for (const type of CODEC_PREFERENCE) {
    try {
      if (isSupported(type)) return type;
    } catch {
      // A browser that throws on a type it does not understand has answered no.
    }
  }
  return null;
}

/** The file extension a stored part should carry, from its recorded type. */
export function extensionFor(mimeType: string): string {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

/**
 * Where one part is stored.
 *
 * Zero-padded, because these are listed and sorted as strings in more places
 * than one — `part-10` sorting before `part-2` would reassemble the meeting in
 * the wrong order, and it would do it silently.
 */
export function chunkPath(
  meetingId: string,
  recordingId: string,
  index: number,
  mimeType: string,
): string {
  const n = String(index).padStart(6, "0");
  return `${meetingId}/${recordingId}/part-${n}.${extensionFor(mimeType)}`;
}

/** Every part of one recording lives under this prefix, so deleting it is one list and one remove. */
export function recordingPrefix(meetingId: string, recordingId: string): string {
  return `${meetingId}/${recordingId}`;
}

/** When a recording started now becomes eligible for deletion. */
export function retentionExpiry(startedAt: Date, days: number = RETENTION_DAYS): Date {
  return new Date(startedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Roughly how large a recording of this length will be, for a warning before it is made. */
export function estimatedBytes(durationSeconds: number): number {
  return Math.round(((VIDEO_BITRATE + AUDIO_BITRATE) / 8) * Math.max(0, durationSeconds));
}

/** A size a person can read. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export type RecordingState = "idle" | "starting" | "recording" | "stopping" | "failed";

/**
 * What the room is told, and who is told it.
 *
 * Everyone sees the same words. A recording notice that only the host can read
 * is not a notice — several US states require every party to a conversation to
 * know it is being recorded, and "the host knew" is not that. So this returns a
 * line for the badge every participant carries, not a host-only status.
 */
export function recordingNotice(state: RecordingState, byName?: string): string | null {
  const who = byName?.trim();
  switch (state) {
    case "starting":
      return "Starting recording…";
    case "recording":
      return who ? `${who} is recording this meeting` : "This meeting is being recorded";
    case "stopping":
      return "Saving recording…";
    case "failed":
      return "Recording stopped — it could not be saved";
    default:
      return null;
  }
}
