"use client";

// A player that can actually seek.
//
// What a meeting recording is, on disk, is a live WebM written in five-second
// parts while the call ran. That shape is what makes it survive a host's laptop
// closing, and it is also what makes a plain <video> almost unusable: a live
// WebM carries no duration in its header and no cue index, because neither can
// be written until a recording that is still running has ended. The browser
// shows a scrubber with no length and refuses to seek, so an hour-long meeting
// can be watched from the beginning and nowhere else.
//
// Byte ranges do not fix that on their own. A byte offset into the middle of a
// WebM is not decodable without the header the first part carries — which is
// why this feeds MediaSource instead: the first part is the initialization
// segment, every part after it is a cluster with its own absolute timestamp,
// and appending part N alone is enough for the browser to play from part N.
// Seeking becomes "which part holds this moment", which is a question the
// timeline answers.
//
// Falls back to the plain element wherever MediaSource or the recording's codec
// is unavailable. That is worse — no seeking — but it plays, and a player that
// renders nothing at all on an older browser would be the bigger regression.
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  formatClock,
  partAtTime,
  partsToAppend,
  rangeHeaderFor,
  type TimelinePart,
} from "@/lib/meetings/recording-timeline";

/** How much video to keep appended ahead of where the viewer is watching. */
const BUFFER_AHEAD_MS = 30_000;
/** Append more once the buffer ahead falls below this. */
const REFILL_AT_MS = 12_000;

interface PartsResponse {
  mimeType: string;
  status: string;
  startedAt: string;
  durationMs: number;
  totalBytes: number;
  parts: TimelinePart[];
}

export interface RecordingPlayerHandle {
  /** Jump to a moment, in milliseconds from the start of the recording. */
  seekTo: (ms: number) => void;
}

export function RecordingPlayer({
  meetingId,
  recordingId,
  ref,
}: {
  meetingId: string;
  recordingId: string;
  ref?: React.Ref<RecordingPlayerHandle>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [meta, setMeta] = useState<PartsResponse | null>(null);
  const [native, setNative] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  const streamUrl = `/api/meetings/${meetingId}/recording/${recordingId}/stream`;

  // Everything the append loop needs, off the render path: appending happens
  // inside MediaSource events, which must not wait on React.
  const state = useRef({
    source: null as MediaSource | null,
    buffer: null as SourceBuffer | null,
    parts: [] as TimelinePart[],
    appended: new Set<number>(),
    /** Serialises appends — a SourceBuffer rejects a second one mid-update. */
    queue: Promise.resolve(),
    ended: false,
  });

  // ── Load the timeline ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}/recording/${recordingId}/parts`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as PartsResponse;
        if (cancelled) return;
        const supported =
          typeof window !== "undefined" &&
          typeof window.MediaSource !== "undefined" &&
          window.MediaSource.isTypeSupported(body.mimeType);
        setMeta(body);
        setNative(!supported);
      } catch {
        // The timeline is what makes seeking possible, not what makes playback
        // possible. Losing it costs the scrubber, not the video.
        if (!cancelled) setNative(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId, recordingId]);

  /** Append a run of parts, in order, one update at a time. */
  const append = useCallback(
    (wanted: TimelinePart[]) => {
      const s = state.current;
      const fresh = wanted.filter((p) => !s.appended.has(p.idx));
      if (fresh.length === 0 || !s.buffer || !s.source) return;
      // Marked before the fetch, not after: two refills racing would otherwise
      // both decide the same part is missing and append it twice.
      for (const p of fresh) s.appended.add(p.idx);

      const range = rangeHeaderFor(fresh);
      if (!range) return;

      s.queue = s.queue
        .then(async () => {
          if (s.source?.readyState !== "open") return;
          const res = await fetch(streamUrl, { headers: { Range: range } });
          if (!res.ok && res.status !== 206) throw new Error(String(res.status));
          const bytes = new Uint8Array(await res.arrayBuffer());
          await new Promise<void>((resolve, reject) => {
            const buffer = s.buffer;
            if (!buffer || s.source?.readyState !== "open") return resolve();
            const done = () => {
              buffer.removeEventListener("updateend", done);
              buffer.removeEventListener("error", fail);
              resolve();
            };
            const fail = () => {
              buffer.removeEventListener("updateend", done);
              buffer.removeEventListener("error", fail);
              reject(new Error("append failed"));
            };
            buffer.addEventListener("updateend", done);
            buffer.addEventListener("error", fail);
            try {
              buffer.appendBuffer(bytes as BufferSource);
            } catch (err) {
              fail();
              throw err;
            }
          });
        })
        .catch((err) => {
          // A part that will not append is a hole, not a dead player: forget it
          // so a later pass can try again, and let playback carry on.
          for (const p of fresh) s.appended.delete(p.idx);
          console.warn("[recording] could not append parts", fresh.map((p) => p.idx), err);
        });
    },
    [streamUrl],
  );

  // ── Wire MediaSource ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!meta || native) return;
    const video = videoRef.current;
    if (!video) return;

    const source = new MediaSource();
    const s = state.current;
    s.source = source;
    s.parts = meta.parts;
    s.appended = new Set();
    s.queue = Promise.resolve();
    s.ended = false;

    const url = URL.createObjectURL(source);
    video.src = url;

    const onOpen = () => {
      try {
        const buffer = source.addSourceBuffer(meta.mimeType);
        s.buffer = buffer;
        // The duration the container never carried. This is what gives the
        // scrubber a length, and it is the whole reason the parts are timed.
        if (meta.durationMs > 0) source.duration = meta.durationMs / 1000;
        append(partsToAppend(meta.parts, 0, BUFFER_AHEAD_MS));
      } catch (err) {
        console.warn("[recording] MediaSource unavailable, falling back", err);
        setNative(true);
      }
    };

    source.addEventListener("sourceopen", onOpen);
    return () => {
      source.removeEventListener("sourceopen", onOpen);
      s.source = null;
      s.buffer = null;
      URL.revokeObjectURL(url);
    };
  }, [meta, native, append]);

  // ── Keep the buffer ahead of the viewer ───────────────────────────────────
  const refill = useCallback(() => {
    const video = videoRef.current;
    const s = state.current;
    if (!video || !s.parts.length || native) return;

    const nowMs = video.currentTime * 1000;
    let bufferedTo = nowMs;
    for (let i = 0; i < video.buffered.length; i++) {
      const start = video.buffered.start(i) * 1000;
      const end = video.buffered.end(i) * 1000;
      if (start <= nowMs + 1 && end >= nowMs) bufferedTo = Math.max(bufferedTo, end);
    }
    if (bufferedTo - nowMs > REFILL_AT_MS) return;

    const next = partAtTime(s.parts, bufferedTo);
    if (next >= 0) append(partsToAppend(s.parts, next, BUFFER_AHEAD_MS));
  }, [append, native]);

  const seekTo = useCallback(
    (ms: number) => {
      const video = videoRef.current;
      const s = state.current;
      if (!video) return;
      const target = Math.max(0, Math.min(ms, meta?.durationMs ?? ms));

      if (native || !s.parts.length) {
        video.currentTime = target / 1000;
        return;
      }

      const idx = partAtTime(s.parts, target);
      if (idx < 0) return;
      append(partsToAppend(s.parts, idx, BUFFER_AHEAD_MS));
      // Set it straight away and again once the data lands: the first is what
      // makes the scrubber feel immediate, the second is what makes it correct
      // when the part had not been fetched yet.
      video.currentTime = s.parts[idx].offsetMs / 1000;
      void s.queue.then(() => {
        if (videoRef.current) videoRef.current.currentTime = target / 1000;
      });
    },
    [append, meta?.durationMs, native],
  );

  useImperativeHandle(ref, () => ({ seekTo }), [seekTo]);

  const durationMs = meta?.durationMs ?? 0;

  if (native) {
    return (
      <div className="flex flex-col gap-2">
        <video controls preload="metadata" className="w-full rounded-lg bg-black aspect-video" src={streamUrl} />
        <p className="text-[11px] text-[var(--fg-muted)]">
          This browser cannot seek inside a meeting recording. It will play from the start.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <video
        ref={videoRef}
        playsInline
        className="w-full rounded-lg bg-black aspect-video"
        onClick={() => (playing ? videoRef.current?.pause() : void videoRef.current?.play())}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          if (!scrubbing) setPositionMs((videoRef.current?.currentTime ?? 0) * 1000);
          refill();
        }}
        onWaiting={refill}
      />

      <div className="flex items-center gap-3">
        <button
          onClick={() => (playing ? videoRef.current?.pause() : void videoRef.current?.play())}
          aria-label={playing ? "Pause" : "Play"}
          className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2.5 py-1 text-xs text-[var(--fg-primary)] hover:border-gold-400/40 transition-colors"
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <input
          type="range"
          min={0}
          max={Math.max(1, durationMs)}
          value={Math.min(positionMs, durationMs || positionMs)}
          aria-label="Seek"
          onChange={(e) => {
            setScrubbing(true);
            setPositionMs(Number(e.target.value));
          }}
          onMouseUp={(e) => {
            setScrubbing(false);
            seekTo(Number((e.target as HTMLInputElement).value));
          }}
          onTouchEnd={(e) => {
            setScrubbing(false);
            seekTo(Number((e.target as HTMLInputElement).value));
          }}
          onKeyUp={(e) => {
            setScrubbing(false);
            seekTo(Number((e.target as HTMLInputElement).value));
          }}
          className="w-full accent-[var(--gold-400)]"
        />

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--fg-muted)]">
          {formatClock(positionMs)} / {formatClock(durationMs)}
        </span>
      </div>
    </div>
  );
}
