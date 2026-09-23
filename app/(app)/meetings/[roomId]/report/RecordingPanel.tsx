"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatSize } from "@/lib/meetings/recording-policy";
import { RecordingPlayer, type RecordingPlayerHandle } from "./RecordingPlayer";

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

interface Recording {
  id: string;
  status: "recording" | "complete" | "failed" | "abandoned";
  duration_seconds: number | null;
  size_bytes: number;
  started_by_name: string | null;
  started_at: string;
  expires_at: string;
  deleted_at: string | null;
  mime_type: string;
}

function clock(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function daysUntil(iso: string): number {
  return Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
}

export function RecordingPanel({
  meetingId,
  playerRef,
  onRecordingReady,
  onTime,
}: {
  meetingId: string;
  /** Handed to the first playable recording, so the transcript can drive it. */
  playerRef?: React.Ref<RecordingPlayerHandle>;
  /** When the recording the transcript should follow is known. */
  /**
   * The recording the transcript is timed against: when it started, and how
   * long it ran.
   *
   * The duration goes up because the page's header has no other source for it
   * on a one-way call — nobody joins a room that does not exist, so the
   * meeting has no started_at to subtract from, and a recorded call showed no
   * length at all despite the recording knowing it exactly.
   */
  onRecordingReady?: (startedAt: string, durationSeconds: number | null) => void;
  /** Where that recording has got to, so the transcript can follow it back. */
  onTime?: (ms: number) => void;
}) {
  const [recordings, setRecordings] = useState<Recording[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      // RLS decides: only the host and people with an attendance row read these
      // rows at all, which is the same rule the reports themselves use.
      const { data } = await supabase
        .from("live_meeting_recordings")
        .select("id, status, duration_seconds, size_bytes, started_by_name, started_at, expires_at, deleted_at, mime_type")
        .eq("meeting_id", meetingId)
        .order("started_at", { ascending: true });
      if (cancelled) return;
      const rows = (data as Recording[] | null) ?? [];
      setRecordings(rows);
      // The transcript follows the first recording that can actually be
      // played. A meeting with two recordings is rare; one whose only
      // recording was deleted or captured nothing is not.
      const playable = rows.find((r) => !r.deleted_at && r.status !== "abandoned");
      if (playable) onRecordingReady?.(playable.started_at, playable.duration_seconds ?? null);
    })();
    return () => { cancelled = true; };
  }, [meetingId, onRecordingReady]);

  if (!recordings?.length) return null;

  // The same row onRecordingReady reports, by the same rule — so the player
  // that drives the transcript and the start time the transcript is offset
  // against can never be two different recordings.
  const playableId = recordings.find((r) => !r.deleted_at && r.status !== "abandoned")?.id;

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
                A recording from {new Date(rec.started_at).toLocaleDateString()} was deleted
                after its 90-day retention period.
              </div>
            );
          }

          if (rec.status === "abandoned") {
            return (
              <div key={rec.id} className="text-xs text-[var(--fg-muted)]">
                A recording was started on {new Date(rec.started_at).toLocaleDateString()} but
                nothing was captured.
              </div>
            );
          }

          const expiringIn = daysUntil(rec.expires_at);

          return (
            <div key={rec.id} className="flex flex-col gap-2">
              <RecordingPlayer
                meetingId={meetingId}
                recordingId={rec.id}
                ref={rec.id === playableId ? playerRef : undefined}
                // The first PLAYABLE recording, which is the row
                // onRecordingReady reports and therefore the clock the
                // transcript is timed against. Keyed on index instead, a
                // meeting whose first row was abandoned or deleted renders no
                // player for it at all — so nothing received the ref, the
                // timestamps seeked nothing and the transcript never followed.
                // Only one: two players reporting into the same follower would
                // make the transcript jump between two clocks.
                onTime={rec.id === playableId ? onTime : undefined}
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
                    without warning is worse than one that was never made. */}
                <span className={expiringIn <= 7 ? "text-[var(--status-warning)]" : undefined}>
                  {expiringIn > 0 ? `Deleted in ${expiringIn} day${expiringIn === 1 ? "" : "s"}` : "Deleted soon"}
                </span>
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
}
