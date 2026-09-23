// lib/meetings/audio-capture.ts
// The decisions a call recorder makes before it touches a microphone.
//
// A one-way call is recorded as AUDIO ONLY, which is the whole reason this
// exists beside recording-policy rather than reusing it. The meeting recorder
// composites a canvas of the room and encodes it at 1.5 Mbit — correct for a
// meeting with faces in it, and absurd for a phone call, where it would spend
// 675 MB an hour on a still picture of nothing. At the audio bitrate the same
// hour is about 57 MB, and the parts, the player, the expiry sweep and the
// delete cleanup all work on it unchanged.
//
// Pure: no MediaRecorder, no getUserMedia, no AudioContext. Everything here is
// a decision about them, which is what makes it testable at all — the browser
// half is a dozen lines of wiring in one-way-recorder.ts.

import { AUDIO_BITRATE } from "@/lib/meetings/recording-policy";

/**
 * Containers to try, best first.
 *
 * Opus in WebM is the one every browser that can record at all agrees on, and
 * it is what the meeting recorder already stores, so the playback route and
 * the player need to learn nothing new. MP4/AAC is here for Safari, which
 * records that and not WebM.
 *
 * Order is quality-per-byte on speech, which is the only content this ever
 * holds.
 */
export const AUDIO_CODEC_PREFERENCE = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/** The first container this browser will actually record, or null if none. */
export function preferredAudioMimeType(isSupported: (type: string) => boolean): string | null {
  for (const type of AUDIO_CODEC_PREFERENCE) {
    if (isSupported(type)) return type;
  }
  return null;
}

/**
 * Bits per second for the encoder.
 *
 * The meeting recorder's audio bitrate, unchanged, because it is already
 * chosen for speech and a phone call is not more demanding than a meeting.
 * Named here so the one-way recorder does not read a constant called
 * AUDIO_BITRATE out of a module about video layout.
 */
export const CALL_AUDIO_BITRATE = AUDIO_BITRATE;

/** Roughly what an hour of call costs to keep, for the line on the recorder. */
export function estimatedCallBytes(durationSeconds: number): number {
  return Math.max(0, Math.round((CALL_AUDIO_BITRATE / 8) * durationSeconds));
}

/**
 * What went wrong, in a sentence the person can act on.
 *
 * getUserMedia and getDisplayMedia report refusal, absence and hardware
 * failure through the same DOMException shape, and the difference matters
 * entirely: "you said no" and "there is no microphone" want opposite
 * responses, and the browser's own message for both is a string like
 * "Permission denied" that names neither.
 */
export function captureErrorMessage(err: unknown, source: "microphone" | "computer"): string {
  const name = errName(err);
  const thing = source === "microphone" ? "microphone" : "computer audio";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return source === "microphone"
        ? "Microphone access was refused. Allow it in your browser's address bar, then try again."
        : "Sharing was cancelled, so computer audio is not being captured.";
    case "NotFoundError":
    case "OverconstrainedError":
      return `No ${thing} was found. Check the device is connected and selected.`;
    case "NotReadableError":
    case "AbortError":
      return `The ${thing} could not be opened — another application may be using it.`;
    default:
      return `The ${thing} could not be captured.`;
  }
}

/**
 * Whether losing this source should stop the recording.
 *
 * The microphone is the recording. Computer audio is an addition, and a person
 * who cancelled the share dialog has said they do not want it — ending their
 * call recording over that would throw away the thing they actually asked for.
 */
export function isFatalCaptureFailure(source: "microphone" | "computer"): boolean {
  return source === "microphone";
}

/**
 * Whether the browser can be asked for the computer's audio at all.
 *
 * Firefox and every mobile browser expose getDisplayMedia and then return a
 * stream with no audio track, so feature-detecting the method is not enough to
 * offer the toggle — it would promise a capture that silently never arrives.
 * The honest answer needs the track, which is why the recorder also checks
 * after the fact; this is the cheap half that keeps the toggle off a phone.
 */
export function canOfferComputerAudio(input: {
  hasDisplayMedia: boolean;
  userAgent: string;
}): boolean {
  if (!input.hasDisplayMedia) return false;
  const ua = input.userAgent.toLowerCase();
  // Tab and system audio is a desktop Chromium capability. Safari does not
  // capture it, Firefox offers the dialog without the track, and no mobile
  // browser does it at all.
  if (/android|iphone|ipad|ipod|mobile/.test(ua)) return false;
  if (/firefox\//.test(ua)) return false;
  const isChromium = /chrome\/|chromium\/|edg\//.test(ua);
  return isChromium;
}

/**
 * What to say when the share produced a stream with no audio in it.
 *
 * This is the common mistake and it is invisible otherwise: the person shares
 * a tab but leaves "Also share tab audio" unticked, the recording runs, and
 * the far end is missing from a file they only listen to later.
 */
export const NO_SHARED_AUDIO_NOTICE =
  "That share had no audio, so only your microphone is being recorded. Re-share and tick “Also share tab audio” to capture the other side.";

function errName(err: unknown): string {
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}
