"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RecordingPanel } from "./RecordingPanel";
import { TranscriptPanel } from "./TranscriptPanel";
import { transcriptCues, type CueRow } from "@/lib/meetings/transcript-cues";
import { playableRecording, type ReportRecording } from "@/lib/meetings/report-page";
import type { RecordingPlayerHandle } from "./RecordingPlayer";
import { momentFromSearch, SEEK_EVENT, type SeekDetail } from "@/lib/meetings/report-moments";
import { useRef } from "react";

/**
 * The recording and the transcript, which are the only two parts of a report
 * that talk to each other.
 *
 * Everything else on this page is now server-rendered markup. These two are not,
 * and cannot be: the transcript is searchable and collapsible, the recording is
 * a <video>, and a line of transcript can seek it while the playhead moves the
 * highlight back. That link is why they share a parent — the playhead lives in
 * one place that both can reach.
 *
 * It is a SMALL parent on purpose. It used to be the whole page: `playheadMs`
 * sat in the page's root, so a second of playback re-rendered the summary, the
 * key points, the action items, the chat and the export menu to move one
 * highlight. Memoising those panels fixed the symptom; hoisting the document out
 * of the client entirely means there is nothing left up there to re-render.
 */
export function ReportMedia({
  meetingId,
  recordings,
  cueRows,
  transcript,
  markers,
}: {
  meetingId: string;
  recordings: readonly ReportRecording[];
  /** The timed rows, read on the server. */
  cueRows: readonly CueRow[];
  /** The stored transcript block, which is what renders when there are no cues. */
  transcript: string | null;
  /** The report's highlights, placed on the recording; ticks on the scrubber. */
  markers?: ReadonlyArray<{ ms: number; label: string }>;
}) {
  const playerRef = useRef<RecordingPlayerHandle | null>(null);
  /**
   * Where the recording has got to, so the transcript can follow it.
   *
   * undefined, not 0: zero is a real position, so starting there marks the first
   * turn as being spoken and scrolls to it before anything has been played.
   */
  const [playheadMs, setPlayheadMs] = useState<number | undefined>(undefined);

  const handleTime = useCallback((ms: number) => {
    // Only when the SECOND changes. `timeupdate` fires about four times a
    // second, and re-rendering an hour-long transcript at that rate to move a
    // highlight that only changes between turns is most of a core for nothing.
    // The first report always lands, because "nothing has played" is not a second.
    setPlayheadMs((prev) =>
      prev !== undefined && Math.floor(ms / 1000) === Math.floor(prev / 1000) ? prev : ms,
    );
  }, []);

  /**
   * A jump asked for before the player existed. It is loaded lazily, so on
   * arrival — when a shared link asks for its moment — there is no handle yet.
   */
  const queued = useRef<{ ms: number; play: boolean } | null>(null);
  const attachPlayer = useCallback((handle: RecordingPlayerHandle | null) => {
    playerRef.current = handle;
    const wanted = queued.current;
    if (handle && wanted) {
      queued.current = null;
      handle.seekTo(wanted.ms, { play: wanted.play });
    }
  }, []);
  const seek = useCallback((ms: number, play: boolean) => {
    if (playerRef.current) playerRef.current.seekTo(ms, { play });
    else queued.current = { ms, play };
  }, []);

  const seekRecording = useCallback((ms: number) => seek(ms, false), [seek]);

  /**
   * Moments asked for from elsewhere on the page — a "▶ 12:34" chip on a
   * decision or an action item — and the one a shared link carries in `?t=`.
   *
   * The link is followed once, on arrival. The player keeps a jump it cannot
   * make yet, so this does not wait for it to load.
   */
  useEffect(() => {
    const onSeek = (e: Event) => {
      const detail = (e as CustomEvent<SeekDetail>).detail;
      if (detail && Number.isFinite(detail.ms)) seek(detail.ms, detail.play);
    };
    window.addEventListener(SEEK_EVENT, onSeek);
    const linked = momentFromSearch(window.location.search);
    if (linked !== null) seek(linked, true);
    return () => window.removeEventListener(SEEK_EVENT, onSeek);
  }, [seek]);

  /**
   * The clock the cues are placed on.
   *
   * Known before this component renders, which is the change. The panel used to
   * fetch its own recordings and hand this back up through a callback, so the
   * timestamps in a transcript were inert until a second round trip landed.
   */
  const recordingStartedAt = playableRecording(recordings)?.started_at ?? null;
  const cues = useMemo(() => transcriptCues(cueRows, recordingStartedAt), [cueRows, recordingStartedAt]);

  return (
    <>
      {/* Renders nothing when there is no recording — most meetings are not
          recorded, and an empty "Recording" heading on every report would be
          noise on the majority of pages to serve the minority. */}
      <RecordingPanel
        meetingId={meetingId}
        recordings={recordings}
        playerRef={attachPlayer}
        onTime={handleTime}
        markers={markers}
      />

      {/* Full transcript, read back into turns rather than shown as the raw
          block it is stored as. */}
      {transcript && (
        <TranscriptPanel
          transcript={transcript}
          cues={cues}
          // Only offered when there is a clock to seek against. Without one the
          // timestamps would be clickable and inert, which is worse than plain.
          onSeek={recordingStartedAt ? seekRecording : undefined}
          currentMs={recordingStartedAt ? playheadMs : undefined}
        />
      )}
    </>
  );
}
