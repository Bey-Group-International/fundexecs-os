// lib/meetings/recording-sweep.server.ts
// Deleting recordings that have aged out, and closing ones that never ended.
//
// Recordings are the most expensive thing this product stores — around 675 MB
// per hour of meeting — and nothing else in the system deletes them. Retention
// that depends on somebody remembering to tidy up is not retention; it is a
// bill that grows until it is noticed.
//
// Two jobs, because both are about recordings whose owner stopped caring:
//
//  - EXPIRED: past `expires_at`. The objects go, the row stays. A row that
//    outlives its bytes is how a viewer following an old link learns that a
//    recording existed and was deleted, rather than that it never existed.
//  - ABANDONED: still marked `recording` long after anyone could still be in
//    the meeting. That is a host whose tab died mid-call. The parts they DID
//    upload are kept and the row is closed out as complete, because those parts
//    are a real, watchable recording of most of a meeting — the whole reason
//    for uploading during the call rather than at the end of it.
// No `server-only` import, matching reminder-sweep.server.ts: the `.server`
// suffix is this repo's marker, and the guard would put this module — the only
// code that deletes a recording — beyond the reach of a unit test.
import type { SupabaseClient } from "@supabase/supabase-js";
import { RECORDING_BUCKET, recordingPrefix } from "@/lib/meetings/recording-policy";
import { buildTimeline, timelineDuration, type StoredPart } from "@/lib/meetings/recording-timeline";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * How long a recording may claim to be running before it is assumed dead.
 *
 * Longer than any real meeting, because closing out a recording that is still
 * being made would mean discarding the rest of it. Six hours is well past the
 * point where a live call is plausible and well short of leaving a row lying
 * indefinitely.
 */
export const ABANDON_AFTER_MS = 6 * 60 * 60 * 1000;

/** Bounded per sweep, like every other job here: a backlog is taken next hour. */
export const MAX_PER_SWEEP = 25;

export interface RecordingSweepStats {
  expired: number;
  abandoned: number;
  /** Meeting folders whose meeting no longer exists. See sweepOrphans. */
  orphaned: number;
  objectsDeleted: number;
  errors: number;
}

/**
 * Meeting folders examined per sweep.
 *
 * The bucket's top level is one folder per meeting that has ever been
 * recorded, so this list only ever grows. Bounded like every other pass here;
 * a backlog is taken next hour.
 */
export const MAX_ORPHAN_CHECK = 200;

/**
 * Objects asked for per listing call, and the most pages one prefix may take.
 *
 * A page is the largest Storage will answer with. The page CAP is a guard
 * against looping forever on a listing that never shortens, not a limit on how
 * long a recording may be: at CHUNK_MS it covers about a hundred and forty
 * hours of meeting, which is not a meeting.
 */
const LIST_PAGE = 1000;
const MAX_LIST_PAGES = 100;

/**
 * Remove every stored part of one recording.
 *
 * Lists the prefix rather than reading the chunk rows: the rows are the index
 * for playback, and an object they have lost track of is exactly the kind of
 * thing that would otherwise be paid for forever.
 *
 * PAGED, which it was not. One call listed at most a thousand objects, and a
 * part is emitted every CHUNK_MS — five seconds — so a thousand parts is
 * eighty-three minutes. Every recording longer than that left its remainder in
 * the bucket while the caller below marked the row deleted, zeroed its size and
 * dropped the chunk rows. After that nothing in the database pointed at those
 * objects at all: unreachable, unbilled to anyone who knew, and permanent. The
 * comment above is exactly the property the cap was quietly defeating, for
 * precisely the recordings that cost the most to keep.
 */
async function removeObjects(supabase: Client, meetingId: string, recordingId: string): Promise<number> {
  return removePrefix(supabase, recordingPrefix(meetingId, recordingId));
}

/** Every object under one prefix, a page at a time. Throws rather than half-deleting. */
async function removePrefix(supabase: Client, prefix: string): Promise<number> {
  const bucket = supabase.storage.from(RECORDING_BUCKET);
  let deleted = 0;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    // Always offset 0: the objects just removed are gone, so the next page of
    // what remains is the first page. Paging by offset over a list being
    // deleted from would skip a page for every page removed.
    const { data, error } = await bucket.list(prefix, { limit: LIST_PAGE });
    if (error) throw error;
    if (!data?.length) return deleted;

    const paths = data.map((o) => `${prefix}/${o.name}`);
    const { error: removeError } = await bucket.remove(paths);
    if (removeError) throw removeError;
    deleted += paths.length;

    // A short page is the last page. Checked after removing rather than before,
    // so a recording of exactly LIST_PAGE parts still costs one extra call
    // instead of leaving its objects behind.
    if (data.length < LIST_PAGE) return deleted;
  }

  // Thrown, not logged and swallowed: the caller must not mark this recording
  // deleted and drop its index while objects it can no longer find remain.
  throw new Error(`[recording-sweep] ${prefix} still has objects after ${MAX_LIST_PAGES} pages`);
}

/** Delete what has aged out, and close out what was never stopped. */
export async function runRecordingSweep(
  supabase: Client,
  now: Date = new Date(),
): Promise<RecordingSweepStats> {
  const stats: RecordingSweepStats = { expired: 0, abandoned: 0, orphaned: 0, objectsDeleted: 0, errors: 0 };

  const { data: expired } = await supabase
    .from("live_meeting_recordings")
    .select("id, meeting_id")
    .is("deleted_at", null)
    .lte("expires_at", now.toISOString())
    .limit(MAX_PER_SWEEP);

  for (const row of (expired ?? []) as { id: string; meeting_id: string }[]) {
    try {
      stats.objectsDeleted += await removeObjects(supabase, row.meeting_id, row.id);
      await supabase
        .from("live_meeting_recordings")
        .update({ deleted_at: now.toISOString(), size_bytes: 0, chunk_count: 0 })
        .eq("id", row.id);
      // The index goes with the bytes: chunk rows pointing at objects that no
      // longer exist would have the playback route stream a file of nothing.
      await supabase.from("live_meeting_recording_chunks").delete().eq("recording_id", row.id);
      stats.expired += 1;
    } catch (err) {
      stats.errors += 1;
      console.error("[recording-sweep] could not expire", row.id, err);
    }
  }

  const cutoff = new Date(now.getTime() - ABANDON_AFTER_MS).toISOString();
  const { data: stale } = await supabase
    .from("live_meeting_recordings")
    .select("id, started_at")
    .eq("status", "recording")
    .lte("started_at", cutoff)
    .limit(MAX_PER_SWEEP);

  for (const row of (stale ?? []) as { id: string; started_at: string }[]) {
    try {
      // Everything below is counted from what actually landed, never from
      // wall-clock time since the host pressed Record: a tab that died at
      // minute four did not record the five hours that followed.
      const { data: chunks } = await supabase
        .from("live_meeting_recording_chunks")
        .select("idx, size, offset_ms, duration_ms")
        .eq("recording_id", row.id);
      const parts = (chunks ?? []) as StoredPart[];
      const bytes = parts.reduce((n, c) => n + (c.size ?? 0), 0);
      // The same figure the player's scrubber shows, from the same rows. This
      // used to be left unset, so a recording the sweep closed was listed with
      // a size and no length at all — the panel renders a duration only when
      // there is one. The timing to compute it has existed since parts began
      // carrying offsets; only the reader was missing.
      const seconds = Math.round(timelineDuration(buildTimeline(parts)) / 1000);

      await supabase
        .from("live_meeting_recordings")
        .update({
          // `complete` rather than `failed` when there are parts: what was
          // uploaded is watchable, and calling it a failure would hide a real
          // recording of most of a meeting behind an error state.
          status: parts.length ? "complete" : "abandoned",
          ended_at: now.toISOString(),
          duration_seconds: seconds,
          size_bytes: bytes,
          chunk_count: parts.length,
        })
        .eq("id", row.id);
      stats.abandoned += 1;
    } catch (err) {
      stats.errors += 1;
      console.error("[recording-sweep] could not close out", row.id, err);
    }
  }

  await sweepOrphans(supabase, stats);

  return stats;
}

/**
 * Delete the recordings of meetings that no longer exist.
 *
 * `live_meeting_recordings.meeting_id` is ON DELETE CASCADE and the chunk rows
 * cascade from it, so deleting a meeting removed every row that knew a
 * recording existed — and none of the bytes. The objects stayed in the bucket
 * with nothing left pointing at them: the expiry pass above reads
 * live_meeting_recordings, and there is no longer a row there to find.
 *
 * Worse than a bill, and this is the part that decides it belongs here rather
 * than in a backlog. They did not become inaccessible-and-therefore-fine: the
 * Storage read policy asks `attended_live_meeting(meeting_id)`, which resolves
 * through `live_meetings`, so with the meeting gone nobody can read them
 * either. A host pressed Delete, was told it was done, and the faces, voices
 * and shared screens stayed — unreachable, unfindable, and kept.
 *
 * The delete route removes them eagerly now, which is what makes "delete this
 * meeting" honest in the moment. This exists because that is not sufficient:
 * it catches every meeting deleted before that change, and the scheduling
 * service, which hard-deletes meetings without going near the route.
 *
 * Driven from the bucket rather than from the database, necessarily — the
 * database is precisely where the evidence was destroyed.
 */
async function sweepOrphans(supabase: Client, stats: RecordingSweepStats): Promise<void> {
  const { data: folders, error } = await supabase.storage
    .from(RECORDING_BUCKET)
    .list("", { limit: MAX_ORPHAN_CHECK });
  if (error || !folders?.length) return;

  // Objects are keyed `<meeting_id>/<recording_id>/part-NNNNNN.webm`, so every
  // top-level entry is a meeting id. Anything that is not one is not ours to
  // reason about and is left alone.
  const meetingIds = folders.map((f) => f.name).filter(isUuid);
  if (meetingIds.length === 0) return;

  // One query, asking which of these still exist. `deleted_at` is deliberately
  // NOT consulted: a soft-deleted meeting is one the host can still restore,
  // and its recording is still readable through the report. Only a row that is
  // gone outright means nothing can ever reach these bytes again.
  const { data: alive, error: readError } = await supabase
    .from("live_meetings")
    .select("id")
    .in("id", meetingIds);
  if (readError) {
    stats.errors += 1;
    console.error("[recording-sweep] could not check for orphaned recordings", readError.message);
    return;
  }

  const living = new Set(((alive ?? []) as { id: string }[]).map((m) => m.id));
  for (const meetingId of meetingIds) {
    if (living.has(meetingId)) continue;
    try {
      stats.objectsDeleted += await removeMeetingFolder(supabase, meetingId);
      stats.orphaned += 1;
    } catch (err) {
      stats.errors += 1;
      console.error("[recording-sweep] could not remove orphaned recording", meetingId, err);
    }
  }
}

/**
 * Every recording under one meeting folder. Storage has no recursive delete.
 *
 * Exported because the delete route calls it directly: a host pressing Delete
 * should not wait up to an hour for the sweep to make it true, and the media is
 * the part of a meeting most worth removing promptly.
 */
export async function removeMeetingRecordings(supabase: Client, meetingId: string): Promise<number> {
  return removeMeetingFolder(supabase, meetingId);
}

async function removeMeetingFolder(supabase: Client, meetingId: string): Promise<number> {
  const { data: recordings, error } = await supabase.storage
    .from(RECORDING_BUCKET)
    .list(meetingId, { limit: LIST_PAGE });
  if (error) throw error;

  let deleted = 0;
  for (const recording of recordings ?? []) {
    deleted += await removePrefix(supabase, `${meetingId}/${recording.name}`);
  }
  return deleted;
}

/**
 * A folder name that is a meeting id.
 *
 * The check exists so a stray object at the bucket root — anything a future
 * feature, a migration or a hand-run script leaves there — is never fed to a
 * delete loop on the strength of not being in `live_meetings`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID.test(value);
}
