"use client";
// The real worker and the real microphone tap, for the room. Kept apart from
// recognition.ts so that file stays testable without a browser.

import { createFallbackRecognition, type CaptureHandle, type FallbackDeps, type WorkerLike } from "./recognition";
import { FALLBACK_MODEL_PROBE, deviceVerdict, type DeviceVerdict } from "./policy";

let shared: Worker | null = null;
function getWorker(): WorkerLike {
  if (!shared) shared = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  return shared as unknown as WorkerLike;
}

// Frames are delivered from an AudioWorklet built from a Blob, so no extra
// public file is needed. The context runs at the device's own rate: Firefox
// refuses to connect a microphone stream to a context at another rate.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      this.buf.push(new Float32Array(ch)); this.n += ch.length;
      if (this.n >= 2048) {
        const out = new Float32Array(this.n); let at = 0;
        for (const b of this.buf) { out.set(b, at); at += b.length; }
        this.buf = []; this.n = 0;
        this.port.postMessage(out, [out.buffer]);
      }
    }
    return true;
  }
}
registerProcessor("fx-tap", Tap);`;

async function startCapture(track: MediaStreamTrack | undefined, onFrame: (f: Float32Array, rate: number) => void): Promise<CaptureHandle> {
  let ownStream: MediaStream | null = null;
  let source: MediaStreamTrack | undefined = track;
  if (!source || source.readyState !== "live") {
    ownStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    source = ownStream.getAudioTracks()[0];
  }
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(ctx, "fx-tap", { numberOfInputs: 1, numberOfOutputs: 0 });
  node.port.onmessage = (e) => onFrame(e.data as Float32Array, ctx.sampleRate);
  // A clone, so stopping the tap never stops the call's own microphone track.
  const src = ctx.createMediaStreamSource(new MediaStream([source.clone()]));
  src.connect(node);
  return {
    stop() {
      try { node.port.onmessage = null; src.disconnect(); node.disconnect(); } catch { /* already gone */ }
      void ctx.close().catch(() => {});
      ownStream?.getTracks().forEach((t) => t.stop());
    },
  };
}

const deps: FallbackDeps = { getWorker, startCapture };

/** A SpeechRecognition-shaped constructor backed by the local model. */
export const FallbackSpeechRecognition = createFallbackRecognition(deps);

/** What this device can do, read from the browser. */
export function readDeviceVerdict(mobile: boolean): DeviceVerdict {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return deviceVerdict({
    cores: nav.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
    mobile,
    hasWorker: typeof Worker !== "undefined",
    hasAudioContext: typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined",
    hasWasm: typeof WebAssembly !== "undefined",
  });
}

/** Whether the model files are installed on this site. Checked once per page. */
let probed: Promise<boolean> | null = null;
export function modelInstalled(): Promise<boolean> {
  if (!probed) {
    probed = fetch(FALLBACK_MODEL_PROBE, { method: "HEAD", cache: "no-store" }).then((r) => r.ok).catch(() => false);
  }
  return probed;
}
