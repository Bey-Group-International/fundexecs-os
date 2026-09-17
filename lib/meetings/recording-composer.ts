// lib/meetings/recording-composer.ts
// The part that touches the browser: canvas, WebAudio, MediaRecorder, upload.
//
// Everything decidable lives next door in recording-layout.ts and
// recording-policy.ts, tested without a browser. This file is the machinery
// those decisions drive — deliberately thin, because none of it can be
// exercised in CI and every line here is a line nothing will ever check.
//
// The shape: a canvas is redrawn every frame from the live <video> elements the
// call already has, its captureStream is combined with a WebAudio mix of every
// participant's audio, and a MediaRecorder encodes the pair. Parts are handed
// to an uploader as they are produced rather than accumulated, so the recording
// on disk trails the meeting by seconds instead of existing only in memory
// until somebody presses Stop.

import {
  AUDIO_BITRATE,
  CHUNK_MS,
  RECORDING_FPS,
  RECORDING_HEIGHT,
  RECORDING_WIDTH,
  VIDEO_BITRATE,
  preferredMimeType,
} from "@/lib/meetings/recording-policy";
import {
  NO_FOCUS,
  byRecentVoice,
  composeStage,
  coverRect,
  stepFocus,
  type FocusState,
  type StageActivity,
  type StageParticipant,
  type StageTile,
} from "@/lib/meetings/recording-layout";

/** What the composer needs to know about the room, re-read every frame. */
export interface RoomSnapshot {
  participants: StageParticipant[];
  /** Per-speaker share over the recent window — VoiceActivityLog.summarize. */
  activity: StageActivity[];
  /** Whoever is sharing their screen, if anyone. */
  screenSharerId: string | null;
  /** The live stream for each participant, by id. */
  streamFor: (id: string) => MediaStream | null;
  /** The screen share's own stream, when there is one. */
  screenStream: () => MediaStream | null;
  /** Every audio source to mix, including the host's own microphone. */
  audioStreams: () => MediaStream[];
}

/** Where a part sits on the recording's own clock. */
export interface PartTiming {
  /** Milliseconds from the start of the recording to the start of this part. */
  offsetMs: number;
  /** How long this part runs. */
  durationMs: number;
}

export interface ComposerHandlers {
  /** Called with each encoded part, in order. Must not throw. */
  onChunk: (blob: Blob, index: number, timing: PartTiming) => void;
  /** Called once when recording stops for any reason, including failure. */
  onStopped: (reason: "stopped" | "error", error?: unknown) => void;
}

const NAME_BAR_HEIGHT = 28;
const CORNER_RADIUS = 8;

/** Colours, matched to the room's own surfaces so the file looks like the product. */
const BACKDROP = "#0b0d10";
const TILE_BG = "#16191d";
const TILE_TEXT = "#e8eaed";

/**
 * Draws, mixes and encodes one meeting.
 *
 * One instance per recording. `start` opens everything, `stop` closes it; there
 * is no pause, because a paused recording is a gap the file cannot express and
 * a viewer cannot see.
 */
export class RecordingComposer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private recorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private readonly connected = new Map<MediaStream, MediaStreamAudioSourceNode>();
  // Its own decode surfaces, one per stream. Deliberately NOT the <video>
  // elements the tiles render: those belong to React, they unmount when a
  // layout changes, and a composer holding a reference to one would draw a
  // detached element — which produces no error and a frozen tile. These are
  // off-DOM, muted (the audio is mixed separately, and an unmuted element
  // would play the room back through the speakers) and owned here.
  private readonly surfaces = new Map<MediaStream, HTMLVideoElement>();
  private frameTimer: number | null = null;
  private focus: FocusState = NO_FOCUS;
  private chunkIndex = 0;
  /**
   * Where the next part starts on the recording's own clock.
   *
   * Measured rather than assumed. MediaRecorder's timeslice is a request, not a
   * promise — a busy tab, a slow encoder or a device change all stretch it —
   * and a timeline built from "five seconds each" drifts away from the video it
   * is meant to describe, which a viewer sees as a scrubber that lands a minute
   * off by the end of a long meeting.
   */
  private partCursorMs = 0;
  private startedAtMs = 0;
  private stopped = false;

  constructor(
    private readonly room: RoomSnapshot,
    private readonly handlers: ComposerHandlers,
  ) {}

  /** The container this browser chose. Null until `start` succeeds. */
  mimeType: string | null = null;

  /**
   * Begin.
   *
   * Throws rather than degrading: a host who pressed Record and got a silent
   * no-op would discover after the meeting that there was nothing to watch.
   */
  start(): void {
    const mime = preferredMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) throw new Error("This browser cannot record video.");
    this.mimeType = mime;

    this.canvas = document.createElement("canvas");
    this.canvas.width = RECORDING_WIDTH;
    this.canvas.height = RECORDING_HEIGHT;
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("This browser cannot composite the call.");
    this.ctx = ctx;

    // A blank first frame, so a recording that fails immediately is still a
    // valid file rather than a zero-byte object.
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT);

    const videoStream = this.canvas.captureStream(RECORDING_FPS);

    // Audio is mixed rather than taken from any one stream: the host's own
    // microphone is a local track that never crosses a peer connection, and the
    // remote streams arrive separately. A recording of only one of them is a
    // recording of a monologue.
    const AudioCtor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) throw new Error("This browser cannot mix the call's audio.");
    this.audioContext = new AudioCtor();
    this.destination = this.audioContext.createMediaStreamDestination();
    this.syncAudioSources();

    const mixed = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...this.destination.stream.getAudioTracks(),
    ]);

    this.recorder = new MediaRecorder(mixed, {
      mimeType: mime,
      videoBitsPerSecond: VIDEO_BITRATE,
      audioBitsPerSecond: AUDIO_BITRATE,
    });

    this.recorder.ondataavailable = (ev) => {
      // Zero-length parts happen at the boundaries and are not worth an object.
      // They are not worth a slot on the clock either: a part that holds
      // nothing did not take any time, and counting it would push everything
      // after it later than it really is.
      if (ev.data && ev.data.size > 0) {
        const elapsed = Math.max(0, Math.round(performance.now() - this.startedAtMs));
        // The event fires at the END of a part, so what has elapsed since the
        // last one is this part's length.
        const timing: PartTiming = {
          offsetMs: this.partCursorMs,
          durationMs: Math.max(1, elapsed - this.partCursorMs),
        };
        this.partCursorMs = elapsed;
        this.handlers.onChunk(ev.data, this.chunkIndex, timing);
        this.chunkIndex += 1;
      }
    };
    this.recorder.onerror = (ev) => {
      this.teardown();
      this.handlers.onStopped("error", (ev as unknown as { error?: unknown }).error);
    };
    this.recorder.onstop = () => {
      if (this.stopped) return;
      this.stopped = true;
      this.teardown();
      this.handlers.onStopped("stopped");
    };

    this.startedAtMs = performance.now();
    this.partCursorMs = 0;
    this.recorder.start(CHUNK_MS);

    // setInterval rather than requestAnimationFrame: rAF is throttled to about
    // one frame a second in a background tab, and a host who switches away to
    // read something would otherwise record a slideshow of the meeting they are
    // still in.
    this.frameTimer = window.setInterval(() => this.drawFrame(), Math.round(1000 / RECORDING_FPS));
  }

  /** Flush the last part and close everything. Safe to call twice. */
  stop(): void {
    if (!this.recorder || this.stopped) return;
    try {
      // requestData first: without it the final partial part is discarded, and
      // the recording ends up to CHUNK_MS short of where the meeting ended.
      if (this.recorder.state === "recording") this.recorder.requestData();
      this.recorder.stop();
    } catch {
      this.stopped = true;
      this.teardown();
      this.handlers.onStopped("stopped");
    }
  }

  /**
   * Keep the audio graph in step with who is in the room.
   *
   * Called every frame, and cheap because it only acts on a difference. Someone
   * joining mid-recording has to be connected or they are silent in the file;
   * someone leaving has to be disconnected or their node leaks for the rest of
   * the meeting.
   */
  private syncAudioSources(): void {
    const ctx = this.audioContext;
    const dest = this.destination;
    if (!ctx || !dest) return;

    const live = new Set<MediaStream>();
    for (const stream of this.room.audioStreams()) {
      if (!stream.getAudioTracks().length) continue;
      live.add(stream);
      if (this.connected.has(stream)) continue;
      try {
        const node = ctx.createMediaStreamSource(stream);
        node.connect(dest);
        this.connected.set(stream, node);
      } catch {
        // A stream with no decodable audio yet; it will be retried next frame.
      }
    }

    for (const [stream, node] of this.connected) {
      if (live.has(stream)) continue;
      try { node.disconnect(); } catch { /* already gone */ }
      this.connected.delete(stream);
    }
  }

  private drawFrame(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    this.syncAudioSources();

    const now = Date.now();
    this.focus = stepFocus(this.focus, this.room.activity, now);

    const stage = composeStage({
      participants: byRecentVoice(this.room.participants, this.room.activity),
      activity: this.room.activity,
      focus: this.focus,
      screenSharerId: this.room.screenSharerId,
      width: RECORDING_WIDTH,
      height: RECORDING_HEIGHT,
    });

    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT);

    if (stage.screenRect) {
      const el = this.surfaceFor(this.room.screenStream());
      // `contain`, not `cover`: cropping a shared screen cuts off the edges of
      // whatever somebody is presenting, which is the content itself.
      if (el && el.videoWidth > 0) {
        const scale = Math.min(
          stage.screenRect.width / el.videoWidth,
          stage.screenRect.height / el.videoHeight,
        );
        const w = el.videoWidth * scale;
        const h = el.videoHeight * scale;
        try {
          ctx.drawImage(
            el,
            stage.screenRect.x + (stage.screenRect.width - w) / 2,
            stage.screenRect.y + (stage.screenRect.height - h) / 2,
            w, h,
          );
        } catch { /* a frame that is not decodable yet */ }
      }
    }

    for (const tile of stage.tiles) this.drawTile(ctx, tile);

    // Streams come and go with the call. Holding a decode surface for somebody
    // who left keeps their last frame decoding for the rest of the meeting.
    //
    // Built from everyone in the ROOM, not from the tiles in this frame. Only
    // five tiles are drawn at a time, so pruning by what is on screen would
    // destroy and rebuild a decode surface every time somebody cycled in and
    // out of the strip — and a newly created <video> shows black until it has
    // decoded a frame, so the recording would flicker exactly when the
    // conversation moved around.
    const live = new Set<MediaStream>();
    for (const p of this.room.participants) {
      const stream = this.room.streamFor(p.id);
      if (stream) live.add(stream);
    }
    const screen = this.room.screenStream();
    if (screen) live.add(screen);
    this.pruneSurfaces(live);
  }

  private drawTile(ctx: CanvasRenderingContext2D, tile: StageTile): void {
    const { rect } = tile;
    if (rect.width <= 1 || rect.height <= 1) return;

    ctx.save();
    roundedPath(ctx, rect.x, rect.y, rect.width, rect.height, CORNER_RADIUS);
    ctx.clip();

    ctx.fillStyle = TILE_BG;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    const el = tile.hasVideo ? this.surfaceFor(this.room.streamFor(tile.id)) : null;
    if (el && el.videoWidth > 0 && el.videoHeight > 0) {
      const src = coverRect(el.videoWidth, el.videoHeight, rect);
      try {
        ctx.drawImage(el, src.sx, src.sy, src.sWidth, src.sHeight, rect.x, rect.y, rect.width, rect.height);
      } catch { /* not decodable yet; the tile stays a name card this frame */ }
    } else {
      // Camera off, or a stream that has not produced a frame. Initials rather
      // than a black rectangle, so a viewer can tell who was in the room.
      ctx.fillStyle = TILE_TEXT;
      ctx.font = `600 ${Math.round(Math.min(rect.width, rect.height) * 0.28)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(tile.displayName), rect.x + rect.width / 2, rect.y + rect.height / 2);
    }

    // The name, always — a recording watched months later is watched by someone
    // who does not recognise everybody in it.
    if (rect.height > NAME_BAR_HEIGHT * 1.8) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(rect.x, rect.y + rect.height - NAME_BAR_HEIGHT, rect.width, NAME_BAR_HEIGHT);
      ctx.fillStyle = TILE_TEXT;
      ctx.font = "500 14px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(
        tile.displayName || "Participant",
        rect.x + 10,
        rect.y + rect.height - NAME_BAR_HEIGHT / 2,
        rect.width - 20,
      );
    }

    ctx.restore();
  }

  /**
   * A playing, off-DOM <video> for a stream, created on first sight.
   *
   * `playsInline` and `muted` are both required rather than cosmetic: without
   * muted, autoplay is refused and the element never produces a frame; without
   * playsInline, iOS Safari takes the stream fullscreen over the call.
   */
  private surfaceFor(stream: MediaStream | null): HTMLVideoElement | null {
    if (!stream || !stream.getVideoTracks().length) return null;
    const existing = this.surfaces.get(stream);
    if (existing) return existing;

    const el = document.createElement("video");
    el.srcObject = stream;
    el.muted = true;
    el.playsInline = true;
    el.autoplay = true;
    void el.play().catch(() => { /* retried implicitly on the next frame */ });
    this.surfaces.set(stream, el);
    return el;
  }

  /** Release decode surfaces for streams that have left the call. */
  private pruneSurfaces(live: ReadonlySet<MediaStream>): void {
    for (const [stream, el] of this.surfaces) {
      if (live.has(stream)) continue;
      try { el.pause(); el.srcObject = null; } catch { /* already released */ }
      this.surfaces.delete(stream);
    }
  }

  private teardown(): void {
    if (this.frameTimer !== null) {
      window.clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    for (const [, node] of this.connected) {
      try { node.disconnect(); } catch { /* already gone */ }
    }
    this.connected.clear();
    this.pruneSurfaces(new Set());
    // Closing the context releases the audio hardware reference. Leaving it
    // open across several recordings in one meeting exhausts the browser's
    // AudioContext budget, and the third recording of a long call silently has
    // no sound.
    if (this.audioContext) {
      void this.audioContext.close().catch(() => { /* already closed */ });
      this.audioContext = null;
    }
    this.destination = null;
    this.recorder = null;
    this.ctx = null;
    this.canvas = null;
  }
}

function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function initials(name: string): string {
  const clean = (name ?? "").trim();
  if (!clean) return "?";
  if (clean.includes("@")) return clean[0].toUpperCase();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
