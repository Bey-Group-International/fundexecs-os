// lib/meetings/fallback/recognition.ts
// An object shaped like the browser's SpeechRecognition, driven by the local
// model. The room treats it as one: attribution, the mute guard, the glossary,
// the host's pause and the saved diagnostics all apply to it unchanged.
//
// What differs from a browser engine, and is said plainly rather than faked:
// there are no interim results (a line arrives whole, a second or two after the
// speaker pauses), and no engine confidence (reported as 0, which the room
// already reads as "no score").

import { UtteranceSegmenter, cleanDecode, resampleTo16k, whisperLanguage } from "./policy";
import type { WorkerRequest, WorkerResponse } from "./protocol";

export interface WorkerLike {
  postMessage(m: WorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", fn: (ev: { data: WorkerResponse }) => void): void;
  removeEventListener(type: "message", fn: (ev: { data: WorkerResponse }) => void): void;
}

export interface CaptureHandle { stop(): void }

export interface FallbackDeps {
  /** One shared worker: loading the model twice would double its memory. */
  getWorker(): WorkerLike;
  /** Delivers mono frames and the rate they were captured at. */
  startCapture(track: MediaStreamTrack | undefined, onFrame: (frame: Float32Array, rate: number) => void): Promise<CaptureHandle>;
}

/** Utterances waiting for the model beyond this are dropped, oldest first. */
export const MAX_BACKLOG = 4;

 
type Handler = ((ev: any) => void) | null;

export function createFallbackRecognition(deps: FallbackDeps) {
  return class FallbackSpeechRecognition {
    continuous = true;
    interimResults = false;
    lang = "";
    onstart: Handler = null;
    onspeechstart: Handler = null;
    onresult: Handler = null;
    onerror: Handler = null;
    onend: Handler = null;

    /** Present as a function so the room treats this engine as one that follows the track. */
    static available(): Promise<string> {
      return Promise.resolve("available");
    }

    private worker = deps.getWorker();
    private capture: CaptureHandle | null = null;
    private segmenter = new UtteranceSegmenter();
    private queue: Float32Array[] = [];
    private busy = false;
    private nextId = 1;
    private inflight = new Set<number>();
    private stopping = false;
    private ended = false;
    private seq = 0;

    private listener = (ev: { data: WorkerResponse }) => {
      const m = ev.data;
      if (m.type === "ready") return void this.onModelReady();
      if (m.type === "model-missing") return void this.fail("service-not-allowed");
      if (m.type === "failed") return void this.fail("audio-capture");
      if (m.type === "result" && this.inflight.delete(m.id)) {
        this.busy = false;
        const text = cleanDecode(m.text);
        if (text && !this.ended) this.emit(text);
        this.pump();
      }
      if (m.type === "decode-failed" && this.inflight.delete(m.id)) {
        this.busy = false;
        this.pump();
      }
    };

    start(track?: MediaStreamTrack): void {
      this.ended = false;
      this.stopping = false;
      this.pendingTrack = track;
      this.worker.addEventListener("message", this.listener);
      this.worker.postMessage({ type: "load" });
    }

    private pendingTrack: MediaStreamTrack | undefined;

    private async onModelReady() {
      if (this.capture || this.ended || this.stopping) return;
      const mySeq = ++this.seq;
      try {
        const handle = await deps.startCapture(this.pendingTrack, (frame, rate) => this.onFrame(frame, rate));
        if (mySeq !== this.seq || this.ended || this.stopping) return handle.stop();
        this.capture = handle;
        this.onstart?.({});
      } catch {
        this.fail("not-allowed");
      }
    }

    private onFrame(frame: Float32Array, rate: number) {
      for (const e of this.segmenter.push(resampleTo16k(frame, rate))) {
        if (e.type === "start") this.onspeechstart?.({});
        else if (e.audio) this.enqueue(e.audio);
      }
    }

    private enqueue(audio: Float32Array) {
      this.queue.push(audio);
      while (this.queue.length > MAX_BACKLOG) this.queue.shift();
      this.pump();
    }

    private pump() {
      if (this.busy) {
        return;
      }
      const audio = this.queue.shift();
      if (!audio) {
        if (this.stopping) this.finish();
        return;
      }
      this.busy = true;
      const id = this.nextId++;
      this.inflight.add(id);
      this.worker.postMessage({ type: "transcribe", id, audio, language: whisperLanguage(this.lang) }, [audio.buffer]);
    }

    private emit(transcript: string) {
      const alt = { transcript, confidence: 0 };
       
      const result: any = [alt];
      result.isFinal = true;
      this.onresult?.({ resultIndex: 0, results: [result] });
    }

    private fail(error: string) {
      this.onerror?.({ error });
      this.finish();
    }

    private finish() {
      if (this.ended) return;
      this.ended = true;
      this.seq++;
      this.capture?.stop();
      this.capture = null;
      this.worker.removeEventListener("message", this.listener);
      this.onend?.({});
    }

    /** Ends capture, still transcribing what was already said, then reports the end. */
    stop(): void {
      if (this.ended) return;
      this.stopping = true;
      this.capture?.stop();
      this.capture = null;
      for (const e of this.segmenter.flush()) if (e.audio) this.queue.push(e.audio);
      if (!this.busy && !this.queue.length) this.finish();
      else this.pump();
    }

    abort(): void {
      this.queue = [];
      this.finish();
    }
  };
}
