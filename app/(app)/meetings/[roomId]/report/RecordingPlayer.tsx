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
  evictionFor,
  formatClock,
  partAtTime,
  partsToAppend,
  rangeHeaderFor,
  type TimelinePart,
} from "@/lib/meetings/recording-timeline";
import { momentLink } from "@/lib/meetings/report-moments";

const CONTROL =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-xs text-[var(--fg-secondary)] transition-colors hover:border-gold-400/40 hover:text-[var(--fg-primary)] sm:min-h-8 sm:px-2.5";

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
  /**
   * Jump to a moment, in milliseconds from the start of the recording, and
   * optionally start playing there. Asked before the player has loaded, the
   * jump is kept and made once it can be — a link to a moment is followed on
   * arrival, which is before anything has loaded.
   */
  seekTo: (ms: number, opts?: { play?: boolean }) => void;
}

/** The speeds the speed button steps through. */
export const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;
/** How far the skip buttons and arrow keys move. */
const SKIP_MS = 15_000;

export function RecordingPlayer({
  meetingId,
  recordingId,
  onTime,
  shareable = false,
  markers = [],
  ref,
}: {
  meetingId: string;
  recordingId: string;
  /**
   * Offer "Copy link to this moment". Only on the recording the transcript is
   * timed against: a link opens THAT player, so offering one from another
   * would point at a different recording than the one being watched.
   */
  shareable?: boolean;
  /**
   * Moments to mark on the scrubber — the report's highlights — each a tick
   * that plays from there. Only meaningful on the timed recording, like
   * `shareable`.
   */
  markers?: ReadonlyArray<{ ms: number; label: string }>;
  /**
   * Where playback has got to, in milliseconds.
   *
   * Reported so the transcript can follow. Seeking was one-way before this:
   * a line could drive the player, and the player told nobody where it was —
   * so watching forty minutes of a meeting meant scrolling the transcript by
   * hand to keep up, which is the work having the two side by side is
   * supposed to remove.
   */
  onTime?: (ms: number) => void;
  ref?: React.Ref<RecordingPlayerHandle>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [meta, setMeta] = useState<PartsResponse | null>(null);
  const [native, setNative] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  /** A jump asked for before the player could make it. */
  const pending = useRef<{ ms: number; play: boolean } | null>(null);
  /** The latest `seekTo`, for the MediaSource open handler, which predates it. */
  const seekRef = useRef<RecordingPlayerHandle["seekTo"] | null>(null);

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
        // A moment asked for before there was a buffer to put it in.
        const wanted = pending.current;
        if (wanted) {
          pending.current = null;
          seekRef.current?.(wanted.ms, { play: wanted.play });
        }
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

  /**
   * Hand back the video the viewer has already watched.
   *
   * Nothing was ever removed before this, so a recording watched through was a
   * recording held entire: measured against an hour-long meeting, 677MB
   * resident by the end — the whole call kept for somebody on the last minute.
   * Whether that becomes a stall is up to the browser's own eviction, which is
   * not a thing to leave to chance: MediaSource throws `QuotaExceededError`
   * when it cannot free enough itself, and an append that throws is a hole in
   * the video.
   *
   * On the same queue as the appends, because a SourceBuffer rejects a second
   * operation while one is in flight — and `remove` is one of those operations,
   * not an exception to it.
   */
  const evict = useCallback((playheadMs: number) => {
    const s = state.current;
    const plan = evictionFor(s.parts, s.appended, playheadMs);
    if (!plan || !s.buffer) return;

    s.queue = s.queue
      .then(async () => {
        const buffer = s.buffer;
        if (!buffer || s.source?.readyState !== "open") return;
        const removed = await new Promise<boolean>((resolve) => {
          const ok = () => {
            buffer.removeEventListener("updateend", ok);
            buffer.removeEventListener("error", bad);
            resolve(true);
          };
          const bad = () => {
            buffer.removeEventListener("updateend", ok);
            buffer.removeEventListener("error", bad);
            resolve(false);
          };
          buffer.addEventListener("updateend", ok);
          buffer.addEventListener("error", bad);
          try {
            buffer.remove(0, plan.untilMs / 1000);
          } catch {
            bad();
          }
        });
        // Only once the bytes are actually gone. Forgetting them while they are
        // still resident would let a refill fetch a part the browser already
        // has; keeping the marks after a successful remove is the worse half —
        // a seek back past the kept window would find every part it needs
        // "already appended", append nothing, and play nothing.
        if (removed) for (const idx of plan.dropped) s.appended.delete(idx);
      })
      .catch((err) => {
        console.warn("[recording] could not release watched video", err);
      });
  }, []);

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

    // Before growing, not on a timer: the moment the buffer needs more is the
    // moment it is worth giving back what nobody is going to watch again, and
    // tying the two together means a paused player queues neither.
    evict(nowMs);

    const next = partAtTime(s.parts, bufferedTo);
    if (next >= 0) append(partsToAppend(s.parts, next, BUFFER_AHEAD_MS));
  }, [append, evict, native]);

  const seekTo = useCallback(
    (ms: number, opts?: { play?: boolean }) => {
      const video = videoRef.current;
      const s = state.current;
      const play = opts?.play === true;
      const target = Math.max(0, Math.min(ms, meta?.durationMs ?? ms));
      // Not ready: no element yet, no timeline yet, or (native) no metadata —
      // a currentTime set before metadata is quietly dropped by browsers.
      if (!video || (!native && !s.buffer) || (native && video.readyState < 1)) {
        pending.current = { ms: target, play };
        return;
      }
      // Autoplay with sound is refused without a gesture; a link followed on
      // arrival lands paused at the moment, which is the next best thing.
      const start = () => {
        if (play) void video.play().catch(() => {});
      };

      if (native || !s.parts.length) {
        video.currentTime = target / 1000;
        start();
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
        start();
      });
    },
    [append, meta?.durationMs, native],
  );
  seekRef.current = seekTo;

  useImperativeHandle(ref, () => ({ seekTo }), [seekTo]);

  // The chosen speed survives a seek and a source swap: set on the element
  // whenever either changes, not once.
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate, meta, native]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const skip = (delta: number) => {
    const now = (videoRef.current?.currentTime ?? 0) * 1000;
    seekTo(now + delta, { play: playing });
  };

  const nextRate = () => {
    const i = PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]);
    setRate(PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length]);
  };

  const copyMoment = async () => {
    const ms = (videoRef.current?.currentTime ?? 0) * 1000;
    const link = momentLink(window.location.href, ms);
    try {
      await navigator.clipboard.writeText(link);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };

  /** Space, J/K/L and the arrows, while the player has focus. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // The scrubber handles its own arrows; a button its own Space.
    if (target.tagName === "INPUT" || (target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter"))) return;
    const video = videoRef.current;
    if (!video) return;
    if (e.key === " " || e.key === "k" || e.key === "K") {
      if (video.paused) void video.play().catch(() => {});
      else video.pause();
    } else if (e.key === "ArrowLeft" || e.key === "j" || e.key === "J") skip(-SKIP_MS);
    else if (e.key === "ArrowRight" || e.key === "l" || e.key === "L") skip(SKIP_MS);
    else return;
    e.preventDefault();
  };

  const durationMs = meta?.durationMs ?? 0;

  if (native) {
    return (
      <div className="flex flex-col gap-2">
        <video
          ref={videoRef}
          controls
          preload="metadata"
          className="w-full rounded-lg bg-black aspect-video"
          src={streamUrl}
          onLoadedMetadata={() => {
            const wanted = pending.current;
            if (wanted) {
              pending.current = null;
              seekTo(wanted.ms, { play: wanted.play });
            }
          }}
          onTimeUpdate={() => onTime?.((videoRef.current?.currentTime ?? 0) * 1000)}
        />
        <p className="text-[11px] text-[var(--fg-muted)]">
          This browser cannot seek inside a meeting recording. It will play from the start.
        </p>
      </div>
    );
  }

  return (
    // Focusable so the keyboard shortcuts work once somebody has clicked into
    // the player, without stealing keys from the rest of the page.
    <div className="flex flex-col gap-2" onKeyDown={onKeyDown} role="group" aria-label="Recording player">
      <video
        ref={videoRef}
        tabIndex={0}
        playsInline
        className="w-full rounded-lg bg-black aspect-video"
        onClick={() => (playing ? videoRef.current?.pause() : void videoRef.current?.play())}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          const ms = (videoRef.current?.currentTime ?? 0) * 1000;
          // The scrub guard is about the SLIDER, which must not fight the
          // thumb somebody is dragging. The transcript has no such conflict
          // and should keep following, so it is told either way.
          if (!scrubbing) setPositionMs(ms);
          onTime?.(ms);
          refill();
        }}
        onWaiting={refill}
      />

      {/* One row on a wide screen; on a phone the scrubber takes its own
          line so it is long enough to aim at, and the buttons sit under it. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:flex-nowrap sm:gap-3">
        <div className="relative order-first w-full basis-full sm:order-none sm:basis-auto sm:flex-1">
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
          className="h-8 w-full accent-[var(--gold-400)] sm:h-auto"
        />
        {/* The highlights, as ticks under the track: where the meeting's
            moments are, and one press to play from any of them. Under rather
            than on the track so they never sit beneath the thumb being dragged. */}
        {durationMs > 0 && markers.length > 0 && (
          <div className="relative h-3">
            {markers
              .filter((m) => m.ms >= 0 && m.ms <= durationMs)
              .map((m, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => seekTo(m.ms, { play: true })}
                  aria-label={`Highlight at ${formatClock(m.ms)}: ${m.label}`}
                  title={`${formatClock(m.ms)} — ${m.label}`}
                  style={{ left: `${(m.ms / durationMs) * 100}%` }}
                  className="group absolute top-0 flex h-3 w-4 -translate-x-1/2 items-start justify-center"
                >
                  <span className="h-2.5 w-1 rounded-full bg-[var(--gold-400)] opacity-70 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
          </div>
        )}
        </div>

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--fg-muted)] sm:order-last">
          {formatClock(positionMs)} / {formatClock(durationMs)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => skip(-SKIP_MS)}
          aria-label="Back 15 seconds"
          title="Back 15 seconds (J or ←)"
          className={CONTROL}
        >
          −15s
        </button>
        <button
          type="button"
          onClick={() => (playing ? videoRef.current?.pause() : void videoRef.current?.play())}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          className={`${CONTROL} min-w-12 text-[var(--fg-primary)]`}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          onClick={() => skip(SKIP_MS)}
          aria-label="Forward 15 seconds"
          title="Forward 15 seconds (L or →)"
          className={CONTROL}
        >
          +15s
        </button>
        <button
          type="button"
          onClick={nextRate}
          aria-label={`Playback speed ${rate}×. Change speed`}
          title="Playback speed"
          className={`${CONTROL} font-mono tabular-nums`}
        >
          {rate}×
        </button>
        {shareable && (
          <button
            type="button"
            onClick={() => void copyMoment()}
            title="Copy a link that opens this report playing from here"
            className={`${CONTROL} ml-auto`}
          >
            {copied === "ok" ? "Link copied" : copied === "failed" ? "Copy failed" : `Link to ${formatClock(positionMs)}`}
          </button>
        )}
        {copied && (
          <span role="status" className="sr-only">
            {copied === "ok" ? "Link to this moment copied" : "The link could not be copied"}
          </span>
        )}
      </div>
    </div>
  );
}
