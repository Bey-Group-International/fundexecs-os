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
  objectsDeleted: number;
  errors: number;
}

/**
 * Remove every stored part of one recording.
 *
 * Lists the prefix rather than reading the chunk rows: the rows are the index
 * for playback, and an object they have lost track of is exactly the kind of
 * thing that would otherwise be paid for forever.
 */
async function removeObjects(supabase: Client, meetingId: string, recordingId: string): Promise<number> {
  const prefix = recordingPrefix(meetingId, recordingId);
  const { data, error } = await supabase.storage.from(RECORDING_BUCKET).list(prefix, { limit: 1000 });
  if (error || !data?.length) return 0;
  const paths = data.map((o) => `${prefix}/${o.name}`);
  const { error: removeError } = await supabase.storage.from(RECORDING_BUCKET).remove(paths);
  if (removeError) throw removeError;
  return paths.length;
}

/** Delete what has aged out, and close out what was never stopped. */
export async function runRecordingSweep(
  supabase: Client,
  now: Date = new Date(),
): Promise<RecordingSweepStats> {
  const stats: RecordingSweepStats = { expired: 0, abandoned: 0, objectsDeleted: 0, errors: 0 };

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

  return stats;
}
