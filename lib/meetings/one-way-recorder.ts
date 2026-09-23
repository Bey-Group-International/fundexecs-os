// lib/meetings/one-way-recorder.ts
// The part that touches the browser for a one-way call: WebAudio, MediaRecorder.
//
// The meeting recorder's shape, with the picture removed. A microphone and,
// optionally, the computer's own output are mixed through a WebAudio graph and
// encoded by a MediaRecorder; parts are handed up on exactly the same contract
// RecordingComposer uses, because everything downstream of that contract —
// the retrying upload, the part rows, the duration taken from the parts, the
// player's seek — is shared and must stay shared.
//
// The part TIMING protocol in particular is copied deliberately rather than
// reinvented: `offset_ms` and `duration_ms` are what let the player seek a
// live WebM that carries no duration and no cue index of its own. Getting
// those subtly different here would produce a file that plays and cannot be
// scrubbed, which is the kind of fault nobody notices until they need it.
//
// Everything that can be decided without a browser is decided in
// audio-capture.ts. What is left here is wiring.

import { CHUNK_MS } from "@/lib/meetings/recording-policy";
import { CALL_AUDIO_BITRATE, preferredAudioMimeType } from "@/lib/meetings/audio-capture";
import type { ComposerHandlers, PartTiming } from "@/lib/meetings/recording-composer";

/** The streams a call is mixed from. The microphone is not optional. */
export interface CallSources {
  microphone: MediaStream;
  /** The computer's own output, when the person chose to capture it. */
  computer: MediaStream | null;
}

/**
 * Records one call. One instance per recording.
 *
 * No pause, for the reason the meeting recorder has none: a pause is a gap the
 * file cannot express and a listener cannot see, and on a call recording it is
 * a gap in a record somebody may later rely on.
 */
export class OneWayRecorder {
  private recorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private nodes: MediaStreamAudioSourceNode[] = [];
  private chunkIndex = 0;
  private startedAtMs = 0;
  private partCursorMs = 0;
  private stopped = false;

  constructor(
    private readonly sources: CallSources,
    private readonly handlers: ComposerHandlers,
  ) {}

  /** The container this browser chose. Null until `start` succeeds. */
  mimeType: string | null = null;

  /**
   * Begin.
   *
   * Throws rather than degrading. Somebody who pressed Record, watched a timer
   * count up through a forty-minute call and then found there was no file is
   * worse off than somebody told immediately that their browser cannot do it.
   */
  start(): void {
    const mime = preferredAudioMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) throw new Error("This browser cannot record audio.");
    this.mimeType = mime;

    const AudioCtor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) throw new Error("This browser cannot mix the call's audio.");

    this.audioContext = new AudioCtor();
    this.destination = this.audioContext.createMediaStreamDestination();

    // Mixed rather than recorded as two tracks. One track is what makes the
    // file playable everywhere and searchable as one transcript; telling the
    // two voices apart is a separate feature with a separate cost, and
    // pretending to do it from a single speakerphone channel would be a lie
    // about who said what in a record somebody may rely on.
    this.connect(this.sources.microphone);
    if (this.sources.computer) this.connect(this.sources.computer);

    this.recorder = new MediaRecorder(this.destination.stream, {
      mimeType: mime,
      audioBitsPerSecond: CALL_AUDIO_BITRATE,
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
      // Marked stopped BEFORE handing the error up. MediaRecorder fires onstop
      // after onerror, and without this that second event reports the same
      // recording as having stopped cleanly — so a failed recording is
      // finalized twice: once as failed, then again as complete, which is the
      // one that sticks.
      if (this.stopped) return;
      this.stopped = true;
      this.teardown();
      this.handlers.onStopped("error", (ev as unknown as { error?: unknown }).error);
    };
    this.recorder.onstop = () => {
      if (this.stopped) return;
      this.stopped = true;
      this.teardown();
      this.handlers.onStopped("stopped");
    };

    // The microphone going away mid-call — unplugged, or taken by another
    // application — ends the recording rather than silently continuing to
    // encode nothing. A file that is quiet for its second half looks exactly
    // like a call where nobody spoke.
    const mic = this.sources.microphone.getAudioTracks()[0];
    if (mic) mic.addEventListener("ended", () => this.stop());

    this.startedAtMs = performance.now();
    this.partCursorMs = 0;
    this.recorder.start(CHUNK_MS);
  }

  /** Flush the last part and close everything. Safe to call twice. */
  stop(): void {
    if (!this.recorder || this.stopped) return;
    try {
      // requestData first: without it the final partial part is discarded, and
      // the recording ends up to CHUNK_MS short of where the call ended.
      if (this.recorder.state === "recording") this.recorder.requestData();
      this.recorder.stop();
    } catch {
      this.stopped = true;
      this.teardown();
      this.handlers.onStopped("stopped");
    }
  }

  private connect(stream: MediaStream): void {
    const ctx = this.audioContext;
    const dest = this.destination;
    if (!ctx || !dest || stream.getAudioTracks().length === 0) return;
    const node = ctx.createMediaStreamSource(stream);
    node.connect(dest);
    this.nodes.push(node);
  }

  /**
   * Close everything this recording opened.
   *
   * The tracks are stopped here, which is what turns the browser's recording
   * indicator off. That matters more than usual for this feature: a microphone
   * left live after the call ended is a microphone the person believes is off.
   *
   * The AudioContext is closed for the reason the meeting recorder closes
   * its own — a browser allows only a handful, and leaking one per recording
   * means the third call of the day silently records nothing.
   */
  private teardown(): void {
    for (const node of this.nodes) {
      try { node.disconnect(); } catch { /* already gone */ }
    }
    this.nodes = [];

    for (const stream of [this.sources.microphone, this.sources.computer]) {
      if (!stream) continue;
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* already stopped */ }
      }
    }

    if (this.audioContext) {
      const ctx = this.audioContext;
      this.audioContext = null;
      void ctx.close().catch(() => { /* closing twice is not an error worth raising */ });
    }
    this.destination = null;
    this.recorder = null;
  }
}
