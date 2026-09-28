// lib/meetings/recording-parts.ts
// Reading a recording's parts in full.
//
// A recording is stored as five-second parts, one row each in
// `live_meeting_recording_chunks`. PostgREST caps every response at `max_rows`
// (1000, see supabase/config.toml) and says nothing when it stops, so an
// unpaged read of a recording longer than about 83 minutes returned its first
// thousand parts and quietly lost the rest: the player's timeline ended early,
// the stream served a file that stopped mid-meeting, and the sweep stored a
// duration and size for only part of what was recorded.
//
// The loop is the transcript reader's — the same cap, the same silent
// truncation, and the same fix — so it is shared rather than written again.

import { readAllTranscriptRows, type TranscriptPage } from "@/lib/meetings/transcript-read";

/** The slice of a Supabase client this needs; any of the three clients will do. */
interface ChunkQuery {
  select(columns: string): ChunkQuery;
  eq(column: string, value: string): ChunkQuery;
  order(column: string, opts: { ascending: boolean }): ChunkQuery;
  range(from: number, to: number): PromiseLike<TranscriptPage<unknown>>;
}

/**
 * Every part of one recording, in order.
 *
 * Ordered by `idx` so the pages are stable — an unordered paged read can return
 * a row twice and skip another, which here would be a repeated or missing five
 * seconds of the meeting. Throws if any page fails: a partial list is the
 * defect this exists to remove.
 */
export async function readAllRecordingParts<T>(
  client: { from(table: string): unknown },
  recordingId: string,
  columns: string,
): Promise<T[]> {
  const rows = await readAllTranscriptRows<unknown>((from, to) =>
    (client.from("live_meeting_recording_chunks") as ChunkQuery)
      .select(columns)
      .eq("recording_id", recordingId)
      .order("idx", { ascending: true })
      .range(from, to),
  );
  return rows as T[];
}
