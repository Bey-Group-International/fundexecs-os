// lib/meetings/use-recording.ts
// The recording lifecycle, as a hook.
//
// Kept out of MeetingRoom because that file is already four thousand lines and
// this is a self-contained machine: press Record, a row is created, a composer
// starts, parts upload as they are produced, and pressing Stop closes the row.
// The decisions it makes live in recording-policy and recording-layout; the
// drawing and encoding live in recording-composer; this is the wiring that
// carries bytes from one to the database.
//
// Uploads go straight from the browser to Storage. There is no API route in the
// write path at all, because there is nothing for one to decide: only the host
// records, the host is signed in, and the RLS on the bucket and both tables
// asks exactly the question that matters — does this person host this meeting.
// A route in the middle would be a body limit and a round trip with no opinion.

"use client";

import { useCallback, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHUNK_MS,
  RECORDING_BUCKET,
  chunkPath,
  type RecordingState,
} from "@/lib/meetings/recording-policy";
import {
  classifyUploadError,
  droppedPartsNotice,
  uploadRetryDelay,
} from "@/lib/meetings/upload-retry";
import type { ComposerHandlers, PartTiming } from "@/lib/meetings/recording-composer";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Anything that can encode a recording into parts.
 *
 * RecordingComposer is one — a canvas of the room plus a mix of its audio. The
 * one-way recorder is another, with no picture at all. They differ entirely in
 * what they capture and not at all in what happens to the parts afterwards,
 * which is what this interface is for: the retrying upload, the part rows, the
 * duration taken from the parts rather than the clock, and the notice telling
 * the host what was lost all live here, once, for both.
 *
 * Writing that twice is not hypothetical harm. The duration used to be
 * computed in two places that disagreed by exactly the parts that were
 * dropped, and a recording was listed a minute longer than the video anyone
 * could watch.
 */
export interface RecordingSource {
  /** The container this browser chose. Null until `start` succeeds. */
  readonly mimeType: string | null;
  /** Begin. Throws rather than degrading into a silent no-op. */
  start(): void;
  /** End. Safe to call more than once. */
  stop(): void;
}

export interface UseRecordingInput {
  supabase: Client;
  meetingId: string | null;
  /** The host's display name, stored so a recording can say who made it. */
  hostName: string;
  /**
   * Build the thing that captures. Called once per recording.
   *
   * A factory rather than an instance because a source owns a camera, an
   * AudioContext and a MediaRecorder: one per recording, opened on start and
   * closed on stop, never reused across two.
   */
  createSource: (handlers: ComposerHandlers) => RecordingSource;
  /**
   * What the row should say it holds before the browser has chosen a container.
   *
   * The column is NOT NULL and the row has to exist before the first part
   * lands, so this is the honest placeholder for the kind of recording being
   * made; the real value is written back as soon as `start` returns.
   */
  fallbackMimeType?: string;
  /** Tell the rest of the room. Everyone sees the badge, not just the host. */
  announce: (recording: boolean) => void;
}

export interface UseRecordingResult {
  state: RecordingState;
  /** Set when a recording failed, for the one line the host is shown. */
  error: string | null;
  /**
   * Something the host should know about a recording that nonetheless worked.
   *
   * Kept apart from `error` because the two want opposite treatment: a failure
   * is an alert that stays until it is dealt with, and this is a note about a
   * file that plays. Rendering "the rest was saved" in a red alert bar with no
   * way to dismiss it would tell the host their recording is broken and then
   * leave the claim on screen for the rest of the meeting.
   */
  notice: string | null;
  /** Put the notice away. */
  dismissNotice: () => void;
  /** Seconds of meeting captured so far. */
  elapsed: number;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * One recording's own state, from the row being created to the row being closed.
 *
 * Mutable on purpose: the upload queue updates the counters from inside a
 * MediaRecorder event, where a React state round trip would stall the encoder.
 * What matters is that the mutation lands on the run it belongs to.
 */
interface RecordingRun {
  readonly id: string;
  readonly startedAt: number;
  bytes: number;
  count: number;
  /**
   * Where the recording ENDS on its own clock — the furthest point any part
   * that actually landed reaches.
   *
   * This is the duration, and it is not the same number as the wall clock
   * since Record was pressed. A part that could not be stored after every
   * retry is five seconds of meeting that is not in the file, and this path
   * counts those (see `dropped`); wall clock counts them anyway. So a
   * recording that lost a minute of a board meeting used to be filed, listed
   * and exported as a minute longer than the video anyone could watch.
   *
   * Computed the same way the sweep and the player's scrubber compute it —
   * the furthest `offsetMs + durationMs` — so all three agree by construction
   * rather than by coincidence.
   */
  endMs: number;
  /**
   * Parts that could not be stored after every attempt. Counted rather than
   * logged: a recording that quietly lost a minute of a board meeting and
   * reported itself complete is worse than one that says so.
   */
  dropped: number;
  /**
   * Whether this recording has already been closed out.
   *
   * The invariant "a recording is finalized exactly once" belongs here, with
   * the code that writes the row, rather than with each source being
   * well-behaved. MediaRecorder fires onstop after onerror, so a source that
   * reports the error and then lets the stop through would have this hook write
   * "failed" and then "complete" over it — and the second one is the one that
   * sticks, filing a broken recording as good.
   */
  closed: boolean;
  /**
   * Parts upload one at a time, in the order the encoder produced them.
   * Concurrent uploads would finish out of order, which does not corrupt the
   * file — each part knows its own index — but does mean a host who stops mid
   * upload can leave a gap with parts on either side of it. A queue makes the
   * stored recording a prefix of the real one, always.
   */
  queue: Promise<void>;
}

export function useRecording(input: UseRecordingInput): UseRecordingResult {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const sourceRef = useRef<RecordingSource | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Everything that belongs to ONE recording, kept together and kept with it.
   *
   * This was six separate refs, and the separation was the bug — twice. Each
   * ref outlived the recording it described, and every path that read one
   * after the fact read whatever the NEXT recording had put there.
   *
   * The id survived a completed recording, so a later start that failed before
   * it could create its own row called finalize("failed") on the PREVIOUS,
   * finished recording: a good file rewritten to a failure, with an ended_at
   * of now and a duration counted from a start hours earlier. The counters
   * survived too, and `start` zeroed them — so stopping and immediately
   * recording again let the second recording blank the first one's byte count
   * and part count while its finalize was still awaiting the upload queue, and
   * blanked the dropped-part count with them, which silently threw away the
   * notice telling the host what the first recording had lost.
   *
   * Passing the run explicitly makes both impossible to write: a function that
   * needs a recording is handed the one it means, and "is this still the
   * current recording" is an identity check rather than a guess.
   */
  const runRef = useRef<RecordingRun | null>(null);

  const { supabase, meetingId, hostName, createSource, announce } = input;
  const fallbackMime = input.fallbackMimeType ?? "video/webm";

  /**
   * Store one part, retrying the failures that are worth retrying.
   *
   * Retrying is safe by construction and always was: the object goes to a path
   * derived from the part's own index with `upsert: true`, and the row upserts
   * on (recording_id, idx). Sending the same part twice is indistinguishable
   * from sending it once. The path paid for that property and then dropped any
   * part whose first attempt failed, which turns a thirty-second wifi stumble
   * in an hour-long meeting into six holes and a recording still filed as
   * complete.
   *
   * Still never fatal. A part that cannot be stored costs five seconds of the
   * recording; giving up on the recording would cost the rest of the meeting.
   * What changes is that it is counted, and the host is told at the end.
   */
  const uploadChunk = useCallback(async (
    run: RecordingRun,
    blob: Blob,
    index: number,
    mimeType: string,
    timing: PartTiming,
  ) => {
    const mId = meetingId;
    if (!mId) return;
    const path = chunkPath(mId, run.id, index, mimeType);

    for (let attempt = 0; ; attempt++) {
      try {
        const { error: uploadError } = await supabase.storage
          .from(RECORDING_BUCKET)
          .upload(path, blob, { contentType: mimeType, upsert: true });
        if (uploadError) throw uploadError;

        // The row is written only after the object exists. A chunk row pointing at
        // an object that was never stored would have the playback route serve a
        // hole in the middle of the meeting.
        const { error: rowError } = await supabase
          .from("live_meeting_recording_chunks")
          .upsert(
            {
              recording_id: run.id,
              idx: index,
              path,
              size: blob.size,
              // Where this part sits on the clock, which is what lets the
              // player seek: the stored stream is a live WebM with no duration
              // and no cue index of its own.
              offset_ms: timing.offsetMs,
              duration_ms: timing.durationMs,
            },
            { onConflict: "recording_id,idx" },
          );
        if (rowError) throw rowError;

        run.bytes += blob.size;
        run.count += 1;
        run.endMs = Math.max(run.endMs, timing.offsetMs + timing.durationMs);
        return;
      } catch (err) {
        const delay = classifyUploadError(err) === "retry" ? uploadRetryDelay(attempt) : null;
        if (delay === null) {
          run.dropped += 1;
          console.warn("[recording] part permanently lost", index, err);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        // The recording may have been stopped and a new one started while this
        // part was waiting. Storing it now would write into the wrong recording.
        if (runRef.current !== run) return;
      }
    }
  }, [supabase, meetingId]);

  const finalize = useCallback(async (run: RecordingRun, status: "complete" | "failed") => {
    // First close wins, which is the one that knows why it ended.
    if (run.closed) return;
    run.closed = true;
    // Everything queued has to land before the row claims to be finished, or
    // the duration and size would describe a recording still being written.
    // Everything read after that await comes off `run`, which no later
    // recording can reach — that await is exactly where the counters used to
    // be swapped out from under this.
    await run.queue;
    // From the parts, never from the clock. See RecordingRun.endMs: the two
    // disagree by exactly the parts that were dropped, and the stored file is
    // the shorter of them.
    const seconds = Math.round(run.endMs / 1000);
    try {
      await supabase
        .from("live_meeting_recordings")
        .update({
          status,
          ended_at: new Date().toISOString(),
          duration_seconds: seconds,
          size_bytes: run.bytes,
          chunk_count: run.count,
        })
        .eq("id", run.id);
    } catch (err) {
      console.warn("[recording] could not close the recording row", err);
    }
  }, [supabase]);

  const stop = useCallback(() => {
    const source = sourceRef.current;
    if (!source) return;
    setState("stopping");
    source.stop();
  }, []);

  const start = useCallback(async () => {
    if (sourceRef.current || !meetingId) return;
    setError(null);
    setNotice(null);
    setState("starting");

    // Declared out here so the catch can close out THIS call's recording and
    // nothing else. Null until the row exists, which is the case the old code
    // got wrong: it read a ref that still held the previous recording's id.
    let started: RecordingRun | null = null;

    try {
      const { data, error: rowError } = await supabase
        .from("live_meeting_recordings")
        .insert({
          meeting_id: meetingId,
          started_by_name: hostName,
          // mime_type is corrected below once the browser has chosen; the column
          // is NOT NULL and the row has to exist before the first part lands.
          mime_type: fallbackMime,
        })
        .select("id")
        .single();
      if (rowError || !data) throw rowError ?? new Error("could not start recording");

      const run: RecordingRun = {
        id: (data as { id: string }).id,
        startedAt: Date.now(),
        bytes: 0,
        count: 0,
        endMs: 0,
        dropped: 0,
        closed: false,
        queue: Promise.resolve(),
      };
      runRef.current = run;
      started = run;

      const source = createSource({
        onChunk: (blob, index, timing) => {
          const mime = source.mimeType ?? fallbackMime;
          // Chained rather than awaited: this runs inside a MediaRecorder event
          // and must return immediately or it stalls the encoder.
          run.queue = run.queue.then(() => uploadChunk(run, blob, index, mime, timing));
        },
        onStopped: (reason, err) => {
          // A recording ends once. MediaRecorder fires onstop after onerror, so
          // without this the "stopped" that follows an "error" would run the
          // success path over it: state back to idle, the error banner cleared,
          // and a broken recording presented as a good one. `closed` is set
          // synchronously by finalize, so the first report has already claimed
          // this run by the time a second one arrives.
          if (run.closed) return;
          if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
          sourceRef.current = null;
          announce(false);
          if (reason === "error") {
            console.error("[recording] stopped on error", err);
            setError("The recording stopped unexpectedly. What was captured has been saved.");
            setState("failed");
            void finalize(run, "failed");
            return;
          }
          setState("idle");
          // Reported only after finalize, which waits on the upload queue: parts
          // are still landing when the recorder stops, and counting the losses
          // before they have all had their attempts would understate them.
          // `run.dropped` rather than a shared ref, so a host who starts the
          // next recording during that wait does not erase what this one lost.
          void finalize(run, "complete").then(() => {
            setNotice(droppedPartsNotice(run.dropped, CHUNK_MS));
          });
        },
      });

      source.start();
      sourceRef.current = source;

      if (source.mimeType) {
        // Best effort: the parts carry the real container in their extension
        // either way, and a failed update must not stop a recording that is
        // already running.
        void supabase
          .from("live_meeting_recordings")
          .update({ mime_type: source.mimeType })
          .eq("id", run.id);
      }

      setElapsed(0);
      tickRef.current = setInterval(
        () => setElapsed(Math.round((Date.now() - run.startedAt) / 1000)),
        1000,
      );

      setState("recording");
      // Announced only once it is really running. Telling the room it is being
      // recorded and then failing to record would be the worse of the two
      // errors to make about consent.
      announce(true);
    } catch (err) {
      console.error("[recording] could not start", err);
      sourceRef.current = null;
      setError(err instanceof Error ? err.message : "Recording could not be started.");
      setState("failed");
      // Only a run THIS call created. The id used to be a ref that outlived the
      // recording it belonged to, so a start that failed before creating its
      // own row closed out the previous, finished recording as a failure.
      if (started) void finalize(started, "failed");
    }
  }, [supabase, meetingId, hostName, createSource, fallbackMime, announce, uploadChunk, finalize]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { state, error, notice, dismissNotice, elapsed, start, stop };
}
