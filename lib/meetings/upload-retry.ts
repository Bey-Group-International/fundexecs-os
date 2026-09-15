// lib/meetings/upload-retry.ts
// Whether a recording part that failed to upload is worth sending again.
//
// The recording write path was built to make retrying safe and then never
// retried. Every part goes to a path derived from its own index, the object is
// written with `upsert: true`, and the row is upserted on (recording_id, idx) —
// so sending the same part twice is indistinguishable from sending it once.
// Having paid for that property, the code dropped any part whose first attempt
// failed and wrote a line to the console.
//
// What that costs is five seconds of the meeting per failure, which sounds
// small until you notice when it happens: uploads run continuously for the
// length of a call, from a browser, on whatever network the host is on. A
// thirty-second wifi stumble in an hour-long board meeting is not one lost
// part, it is six — and the recording is still filed as "complete", because
// nothing counted them.
//
// So parts are retried, and the ones that still cannot be stored are counted
// and reported rather than logged and forgotten.
//
// Pure: no fetch, no Supabase, no timers. The hook supplies the error.

/** What to do about an upload that failed. */
export type UploadVerdict =
  /** Transient. The same request may well succeed in a moment. */
  | "retry"
  /** Nothing about repeating this request can change the answer. */
  | "give_up";

/**
 * Whether this failure is worth another attempt.
 *
 * The distinction is whether the request was refused or merely lost. A network
 * error, a timeout, a 5xx from storage or a 429 are all "ask again". A 401, 403
 * or 413 are decisions: the host's session has expired, the policy says no, or
 * the part is larger than the bucket accepts, and the same bytes sent again get
 * the same answer.
 *
 * Anything unrecognised is retried. An upload path that gives up on a failure
 * it does not understand loses meeting footage to a typo in an error message;
 * one that retries wastes at most three requests.
 */
export function classifyUploadError(err: unknown): UploadVerdict {
  const status = statusOf(err);
  if (status === null) return "retry";
  if (status === 408 || status === 429) return "retry";
  if (status >= 500) return "retry";
  if (status >= 400) return "give_up";
  return "retry";
}

/**
 * The HTTP status buried in a Supabase storage error, or null.
 *
 * Storage errors arrive with `status` or `statusCode`, sometimes as a string,
 * and a plain network failure is a TypeError with neither. Read defensively:
 * this decides whether footage is kept, and a shape that does not match must
 * fall through to retrying rather than to discarding.
 */
function statusOf(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const raw = (err as { status?: unknown; statusCode?: unknown });
  for (const value of [raw.status, raw.statusCode]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * How long to wait before attempt number `attempt` (0-based), or null to stop.
 *
 * Short and few. Parts arrive every few seconds and are uploaded in order, so a
 * part that retries for a minute is a part holding up every part behind it —
 * the queue is what makes the stored recording a prefix of the real one, and
 * that property is worth more than any single five-second segment. Three
 * attempts inside about eight seconds covers the stumbles worth covering and
 * gets out of the way of the ones that are not.
 */
export const UPLOAD_RETRY_DELAYS_MS: readonly number[] = [500, 2_000, 5_000];

export function uploadRetryDelay(attempt: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 0) return null;
  return UPLOAD_RETRY_DELAYS_MS[attempt] ?? null;
}

/** How many attempts a part gets in total, counting the first. */
export const UPLOAD_MAX_ATTEMPTS = UPLOAD_RETRY_DELAYS_MS.length + 1;

/**
 * What to tell the host about a recording that lost parts.
 *
 * Null when nothing was lost, so a clean recording says nothing at all. When
 * something was lost it says how much in seconds rather than in parts, because
 * "4 chunks" means nothing to the person deciding whether to re-record the
 * meeting and "about 20 seconds" means everything.
 *
 * It does not call the recording broken. What was captured is there and plays;
 * the gaps are gaps. Telling somebody their recording failed when they have a
 * usable file would cost them a meeting they did not need to repeat.
 */
export function droppedPartsNotice(dropped: number, chunkMs: number): string | null {
  if (!Number.isFinite(dropped) || dropped <= 0) return null;
  const seconds = Math.round((dropped * chunkMs) / 1000);
  const amount = seconds >= 60
    ? `about ${Math.round(seconds / 60)} minute${Math.round(seconds / 60) === 1 ? "" : "s"}`
    : `about ${seconds} second${seconds === 1 ? "" : "s"}`;
  return `${amount} of this recording could not be uploaded and is missing. The rest was saved.`;
}
