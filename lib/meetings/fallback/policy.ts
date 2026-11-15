// lib/meetings/fallback/policy.ts
// When the in-house recogniser runs instead of the browser's, and whether the
// device can carry it. Pure: the room reads the facts and acts on the answer.
//
// The browser's own SpeechRecognition is the first choice everywhere it works.
// Firefox ships none. Safari ships one that ignores the call's microphone track
// (see recognizer-input.ts) and that phones skip altogether. For those two the
// room runs a Whisper-class model in a worker, from files served by this site:
// no audio leaves the device and no third party is called at runtime.

/** Where the model files are served from. Same origin; never a remote host. */
export const FALLBACK_MODEL_BASE = "/models/";
/** The model's folder under the base, and the file that proves it is installed. */
export const FALLBACK_MODEL_ID = "whisper-base";
export const FALLBACK_MODEL_PROBE = `${FALLBACK_MODEL_BASE}${FALLBACK_MODEL_ID}/config.json`;

export interface FallbackChoiceFacts {
  /** The page exposes SpeechRecognition / webkitSpeechRecognition. */
  hasNativeRecognizer: boolean;
  /** Safari, as `browserBrand` names it. */
  isSafari: boolean;
  mobile: boolean;
}

/** Whether to prefer the in-house recogniser over the browser's. */
export function wantsFallback(f: FallbackChoiceFacts): boolean {
  if (!f.hasNativeRecognizer) return true;
  // Desktop Safari has an engine but it listens to the system default mic.
  // On a phone the policy already skips it; the model is too heavy there.
  return f.isSafari && !f.mobile;
}

export interface DeviceFacts {
  cores: number | null;
  /** navigator.deviceMemory in GB where the browser reports it. */
  memoryGb: number | null;
  mobile: boolean;
  hasWorker: boolean;
  hasAudioContext: boolean;
  hasWasm: boolean;
}

export type DeviceVerdict = { ok: true } | { ok: false; reason: string };

/** Minimum logical cores: the base model needs headroom beside a video call. */
export const MIN_CORES = 4;
export const MIN_MEMORY_GB = 4;

/** Can this device keep up? Unknown cores or memory is given the benefit of the doubt. */
export function deviceVerdict(d: DeviceFacts): DeviceVerdict {
  if (d.mobile) return { ok: false, reason: "phones and tablets are too slow to transcribe in the browser" };
  if (!d.hasWorker || !d.hasAudioContext || !d.hasWasm) return { ok: false, reason: "this browser lacks workers, WebAssembly or Web Audio" };
  if (d.cores !== null && d.cores < MIN_CORES) return { ok: false, reason: `only ${d.cores} CPU cores` };
  if (d.memoryGb !== null && d.memoryGb < MIN_MEMORY_GB) return { ok: false, reason: `only ${d.memoryGb} GB of memory` };
  return { ok: true };
}

/** What the member is told when their device cannot transcribe. */
export const FALLBACK_UNAVAILABLE_NOTICE =
  "Your browser can't transcribe your microphone on this device. You can still be heard, and you'll see everyone else's lines. "
  + "Chrome or Edge on a computer will transcribe you.";

// ─── Language ───────────────────────────────────────────────────────────────

const WHISPER_LANGUAGES: Record<string, string> = {
  en: "english", es: "spanish", fr: "french", de: "german", it: "italian", pt: "portuguese", nl: "dutch",
  sv: "swedish", da: "danish", no: "norwegian", fi: "finnish", pl: "polish", cs: "czech", tr: "turkish",
  ru: "russian", uk: "ukrainian", ar: "arabic", he: "hebrew", hi: "hindi", ja: "japanese", ko: "korean",
  zh: "chinese", id: "indonesian", vi: "vietnamese", th: "thai", el: "greek", ro: "romanian", hu: "hungarian",
};

/** A BCP 47 tag as the model's language name, or undefined to let it detect. */
export function whisperLanguage(tag: string | null | undefined): string | undefined {
  const primary = (tag ?? "").toLowerCase().split(/[-_]/)[0];
  return WHISPER_LANGUAGES[primary];
}

// ─── What the model says when nobody spoke ──────────────────────────────────

const PHANTOMS = [
  /^\W*thank(s| you)( so much)?( for (watching|listening))?\W*$/i,
  /^\W*(you|bye|okay|ok|so)\W*$/i,
  /^\W*\[?(blank[_ ]audio|silence|music|applause|laughter|inaudible)\]?\W*$/i,
  /^\W*[♪♫\s.]+\W*$/,
  /subtitles? by|amara\.org|transcribed by/i,
];

/**
 * The text to keep from one decode, or null. Whisper invents short stock
 * phrases over room tone and loops a phrase when it loses the thread; both
 * would otherwise reach the report as things a member said.
 */
export function cleanDecode(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (PHANTOMS.some((re) => re.test(t))) return null;
  const words = t.toLowerCase().split(" ");
  if (words.length >= 8) {
    const distinct = new Set(words).size;
    if (distinct / words.length < 0.25) return null;
  }
  return t;
}

// ─── Audio ──────────────────────────────────────────────────────────────────

export const MODEL_RATE = 16000;

/** Linear resampling of mono samples to the model's rate. Firefox cannot open a 16 kHz context on a mic stream. */
export function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === MODEL_RATE) return input;
  const ratio = fromRate / MODEL_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = pos - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}

export function rms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / Math.max(1, frame.length));
}

export interface SegmenterOptions {
  /** RMS at or above this is speech. */
  threshold: number;
  /** Silence this long ends an utterance. */
  endSilenceMs: number;
  /** Shorter than this is a click or cough, dropped. */
  minMs: number;
  /** Longer is cut here so a monologue still produces lines. */
  maxMs: number;
  /** Audio kept from before the first loud frame so the first word is not clipped. */
  prerollMs: number;
}

export const DEFAULT_SEGMENTER: SegmenterOptions = { threshold: 0.012, endSilenceMs: 700, minMs: 400, maxMs: 15000, prerollMs: 300 };

export interface SegmenterEvent {
  type: "start" | "utterance";
  /** For "utterance": the audio at 16 kHz. */
  audio?: Float32Array;
  /** Milliseconds of speech in the utterance. */
  durationMs?: number;
}

/** Cuts a stream of 16 kHz frames into utterances. Stateful, clock-free: time is the samples. */
export class UtteranceSegmenter {
  private opts: SegmenterOptions;
  private preroll: Float32Array[] = [];
  private prerollSamples = 0;
  private active: Float32Array[] = [];
  private activeSamples = 0;
  private silentSamples = 0;

  constructor(opts: Partial<SegmenterOptions> = {}) {
    this.opts = { ...DEFAULT_SEGMENTER, ...opts };
  }

  private ms(samples: number): number {
    return (samples / MODEL_RATE) * 1000;
  }

  push(frame: Float32Array): SegmenterEvent[] {
    const events: SegmenterEvent[] = [];
    const loud = rms(frame) >= this.opts.threshold;

    if (!this.active.length) {
      if (!loud) {
        this.preroll.push(frame);
        this.prerollSamples += frame.length;
        while (this.preroll.length > 1 && this.ms(this.prerollSamples - this.preroll[0].length) >= this.opts.prerollMs) {
          this.prerollSamples -= this.preroll.shift()!.length;
        }
        return events;
      }
      this.active = [...this.preroll, frame];
      this.activeSamples = this.prerollSamples + frame.length;
      this.preroll = [];
      this.prerollSamples = 0;
      this.silentSamples = 0;
      events.push({ type: "start" });
      return events;
    }

    this.active.push(frame);
    this.activeSamples += frame.length;
    this.silentSamples = loud ? 0 : this.silentSamples + frame.length;

    const ended = this.ms(this.silentSamples) >= this.opts.endSilenceMs;
    const tooLong = this.ms(this.activeSamples) >= this.opts.maxMs;
    if (ended || tooLong) {
      const speechMs = this.ms(this.activeSamples - this.silentSamples);
      const audio = new Float32Array(this.activeSamples);
      let at = 0;
      for (const f of this.active) { audio.set(f, at); at += f.length; }
      this.active = [];
      this.activeSamples = 0;
      this.silentSamples = 0;
      if (speechMs >= this.opts.minMs) events.push({ type: "utterance", audio, durationMs: speechMs });
    }
    return events;
  }

  /** The call ended or the mic was switched: hand back whatever was being said. */
  flush(): SegmenterEvent[] {
    if (!this.active.length) return [];
    const speechMs = this.ms(this.activeSamples - this.silentSamples);
    const audio = new Float32Array(this.activeSamples);
    let at = 0;
    for (const f of this.active) { audio.set(f, at); at += f.length; }
    this.active = []; this.activeSamples = 0; this.silentSamples = 0;
    return speechMs >= this.opts.minMs ? [{ type: "utterance", audio, durationMs: speechMs }] : [];
  }
}
