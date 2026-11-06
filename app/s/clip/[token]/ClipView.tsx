"use client";

// A shared clip: the clip's own file (cut on the server), with the words said
// in it alongside — the line being spoken marked as it plays, and any line a
// press away. Times shown are the recording's, so "34:10" means what it meant
// in the meeting; the player runs on the clip's clock, which starts at
// `baseMs` into the recording.

import { useRef, useState } from "react";
import { RecordingPlayer, type RecordingPlayerHandle } from "@/app/(app)/meetings/[roomId]/report/RecordingPlayer";
import { formatClock } from "@/lib/meetings/recording-timeline";
import type { TranscriptCue } from "@/lib/meetings/transcript-cues";

/** The cue being spoken at a moment: the last one that has started. */
export function activeCueIndex(cues: readonly TranscriptCue[], ms: number): number {
  let at = -1;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].atMs <= ms + 250) at = i;
    else break;
  }
  return at;
}

export function ClipView({
  token,
  title,
  meetingTitle,
  meetingId,
  recordingId,
  startMs,
  endMs,
  baseMs,
  expiresAt,
  allowDownload,
  cues,
}: {
  token: string;
  title: string;
  meetingTitle: string;
  meetingId: string;
  recordingId: string;
  startMs: number;
  endMs: number | null;
  /** Where the clip's file begins in the recording (its first keyframe). */
  baseMs: number;
  expiresAt: string;
  allowDownload: boolean;
  /** On the clip's clock. */
  cues: TranscriptCue[];
}) {
  const player = useRef<RecordingPlayerHandle>(null);
  const clipStart = Math.max(0, startMs - baseMs);
  const clipEnd = endMs === null ? null : Math.max(clipStart + 1, endMs - baseMs);
  const [nowMs, setNowMs] = useState(clipStart);
  const active = activeCueIndex(cues, nowMs);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">Shared clip</span>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--fg-primary)]">{title}</h1>
        <p className="text-sm text-[var(--fg-secondary)]">
          {title !== meetingTitle ? `From “${meetingTitle}” · ` : ""}
          {formatClock(startMs)}
          {endMs !== null ? `–${formatClock(endMs)}` : ""}
        </p>
      </header>

      <RecordingPlayer
        ref={player}
        meetingId={meetingId}
        recordingId={recordingId}
        source={{ partsUrl: `/api/clip/${token}/parts`, streamUrl: `/api/clip/${token}/stream` }}
        clip={{ startMs: clipStart, endMs: clipEnd }}
        onTime={setNowMs}
      />

      {allowDownload ? (
        <a
          href={`/api/clip/${token}/stream?download=1`}
          download
          className="self-start rounded-md border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--fg-primary)] hover:bg-[var(--surface-2)]"
        >
          Download clip
        </a>
      ) : null}

      {cues.length > 0 ? (
        <section aria-label="Transcript" className="flex flex-col gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-3">
          <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--fg-muted)]">Transcript</h2>
          <ol className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
            {cues.map((cue, i) => (
              <li key={`${cue.atMs}-${i}`}>
                <button
                  type="button"
                  aria-current={i === active ? "true" : undefined}
                  onClick={() => player.current?.seekTo(Math.max(clipStart, cue.atMs), { play: true })}
                  className={`flex w-full gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                    i === active ? "bg-[var(--gold-400)]/15" : "hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <span className="w-12 shrink-0 font-mono text-[11px] tabular-nums text-[var(--fg-muted)]">{formatClock(cue.atMs + baseMs)}</span>
                  <span className="min-w-0">
                    <span className="font-medium text-[var(--fg-secondary)]">{cue.speaker}: </span>
                    <span className="text-[var(--fg-primary)]">{cue.paragraphs.join(" ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p className="text-xs text-[var(--fg-muted)]">
        This link stops working on {new Date(expiresAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.
      </p>
    </div>
  );
}
