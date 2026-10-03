"use client";

import { memo } from "react";
import { formatSize } from "@/lib/meetings/recording-policy";
import { playableRecording, type ReportRecording } from "@/lib/meetings/report-page";
import { ExpiresIn, LocalTime } from "./LocalTime";
import nextDynamic from "next/dynamic";
import type { RecordingPlayerHandle } from "./RecordingPlayer";

/**
 * The player, fetched only when there is something to play.
 *
 * Most meetings are not recorded — the comment on this panel's call site says so
 * — and the player is the largest component on the report. It was imported
 * statically, so every reader of every report downloaded a video player, a
 * timeline and a seek bar to render nothing.
 *
 * `ref` survives the split because React 19 passes refs as ordinary props and
 * RecordingPlayer takes one. That matters more than the bytes: the ref is what
 * lets a transcript line seek the recording, and a lazy wrapper that swallowed
 * it would leave the timestamps clickable and inert.
 */
const RecordingPlayer = nextDynamic(
  () => import("./RecordingPlayer").then((m) => m.RecordingPlayer),
  {
    ssr: false,
    loading: () => (
      <div className="h-40 animate-pulse rounded-lg border border-[var(--line)] bg-[var(--surface-2)]" />
    ),
  },
);

/**
 * The recording, on the report page.
 *
 * Plays through the app's own route rather than a signed Storage URL, because
 * the recording is not one object: it is uploaded as five-second parts while
 * the meeting runs, so a host's laptop closing costs seconds rather than an
 * hour. The route stitches them and answers Range requests, which is what lets
 * this <video> element seek (see lib/meetings/recording-range.ts).
 *
 * Renders nothing at all when there is no recording — most meetings are not
 * recorded, and an empty "Recording" heading on every report would be noise on
 * the majority of pages to serve the minority.
 */

function clock(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Memoised because the report page holds the recording's playhead in its own
 * state, and only the transcript reads it. Without this, every second of
 * playback re-rendered this component for nothing.
 *
 * It holds the <video> element. Its props are the meeting id, a ref, and two callbacks the page memoises, so none of them move as the recording plays — which is the whole point: the panel REPORTS the playhead and must not be re-rendered by it.
 */
export const RecordingPanel = memo(function RecordingPanel({
  meetingId,
  recordings,
  playerRef,
  onTime,
}: {
  meetingId: string;
  /**
   * The rows, read on the server.
   *
   * This panel used to fetch them on mount and then report the playable one's
   * start time back UP to the page through a callback, because the transcript
   * needs that time to place its cues on the recording's clock. So the
   * timestamps in a transcript could not become clickable until a second browser
   * round trip had landed, and the page held state whose only purpose was to
   * carry an answer back from a child. All of it is known before the page
   * renders now, so the callback and the state are gone.
   */
  recordings: readonly ReportRecording[];
  /** Handed to the first playable recording, so the transcript can drive it. */
  playerRef?: React.Ref<RecordingPlayerHandle>;
  /** Where that recording has got to, so the transcript can follow it back. */
  onTime?: (ms: number) => void;
}) {
  if (!recordings.length) return null;

  // The same row the page offsets the cues against, by the same rule — so the
  // player that drives the transcript and the clock it is timed against can
  // never be two different recordings.
  const playableId = playableRecording(recordings)?.id;

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-5">
      <h2 className="text-sm font-semibold text-[var(--fg-primary)] mb-1">
        {recordings.length > 1 ? "Recordings" : "Recording"}
      </h2>
      <p className="text-xs text-[var(--fg-muted)] mb-4">
        Visible to the people who were in this meeting.
      </p>

      <div className="flex flex-col gap-5">
        {recordings.map((rec) => {
          // Said plainly rather than shown as a broken player. A recording that
          // aged out is a different thing from one that failed, and a viewer
          // following an old link deserves to know which.
          if (rec.deleted_at) {
            return (
              <div key={rec.id} className="text-xs text-[var(--fg-muted)]">
                A recording from{" "}
                <LocalTime iso={rec.started_at} options={{ dateStyle: "medium" }} /> was deleted
                after its 90-day retention period.
              </div>
            );
          }

          if (rec.status === "abandoned") {
            return (
              <div key={rec.id} className="text-xs text-[var(--fg-muted)]">
                A recording was started on{" "}
                <LocalTime iso={rec.started_at} options={{ dateStyle: "medium" }} /> but
                nothing was captured.
              </div>
            );
          }

          return (
            <div key={rec.id} className="flex flex-col gap-2">
              <RecordingPlayer
                meetingId={meetingId}
                recordingId={rec.id}
                ref={rec.id === playableId ? playerRef : undefined}
                // The first PLAYABLE recording, which is the row the page
                // offsets the cues against and therefore the clock the
                // transcript is timed against. Keyed on index instead, a
                // meeting whose first row was abandoned or deleted renders no
                // player for it at all — so nothing received the ref, the
                // timestamps seeked nothing and the transcript never followed.
                // Only one: two players reporting into the same follower would
                // make the transcript jump between two clocks.
                onTime={rec.id === playableId ? onTime : undefined}
                shareable={rec.id === playableId}
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--fg-muted)]">
                {rec.status === "recording" && (
                  <span className="text-[var(--status-warning)]">Still recording — this will grow</span>
                )}
                {rec.status === "failed" && (
                  <span className="text-[var(--status-warning)]">
                    Recording ended unexpectedly; what was captured is here
                  </span>
                )}
                {rec.started_by_name && <span>Recorded by {rec.started_by_name}</span>}
                {rec.duration_seconds ? <span>{clock(rec.duration_seconds)}</span> : null}
                {rec.size_bytes > 0 && <span>{formatSize(rec.size_bytes)}</span>}
                {/* The expiry is stated, not implied. A recording that vanishes
                    without warning is worse than one that was never made.
                    Counted from the BROWSER's clock: this panel is rendered on
                    the server now, and a countdown computed there differs from
                    the reader's own day. */}
                <ExpiresIn iso={rec.expires_at} />
                {/* Until this there was nothing anybody could do about that
                    expiry, which makes stating it worse than not stating it.
                    A plain anchor: the route sets Content-Disposition, so the
                    browser saves it with no object URL to leak. */}
                <a
                  href={`/api/meetings/${meetingId}/recording/${rec.id}/stream?download=1`}
                  download
                  className="text-[var(--gold-400)] hover:underline"
                >
                  Download
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
});
