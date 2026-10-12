// lib/meetings/recognizer-input.ts
// What to hand the speech recogniser so that it hears the microphone the
// member PICKED — not whichever one the operating system calls the default.
//
// The Web Speech API offers one way to choose the recogniser's input:
// `recognition.start(track)`. Three kinds of engine answer it:
//
//  - Chromium with MediaStreamTrack support (it ships beside the static
//    `available()`) honours the track. The call's own echo-cancelled mic track
//    is the right input: one capture, the picked device, nothing else heard.
//
//  - Microsoft Edge is that same Chromium with its own speech backend. It
//    accepts the track and returns nonsense from it: the diagnostic rows of
//    12 October 2026 (room fcb-xff-yq) show the host on Edge, the picked mic
//    being the system default, every line three or four punctuated words
//    ("Pasha put water by shoe.") at a reported confidence of exactly 1.0,
//    and the engine dying every thirty seconds — sixty-six runs in one
//    call — while the Chrome guest in the same call kept thirty-word lines
//    for thirty-three minutes in a single run. Before the room started
//    handing Edge a track (2 October), the same host's lines ran fourteen
//    to twenty-eight words. What Edge mangles is the processed WebRTC track;
//    it is given a capture of its own instead — of the PICKED device, so the
//    recogniser still hears the microphone the member chose.
//
//  - Everything else (Safari, Chromium before track support) ignores the
//    argument and opens its own capture of the system default. Nothing in a
//    page can redirect that; the room says so when the picked device is not
//    the default (transcriptionMicNotice). These are still HANDED the track:
//    an engine that ignores it loses nothing, and a Chromium that honours it
//    without yet exposing `available()` gains the picked microphone.
//
// Pure: no DOM. The room reads the facts and acts on the answer.

/** Where the recogniser's audio comes from. */
export type RecognizerInputMode =
  /** The call's own mic track, handed with `start(track)`; engines that ignore it capture the default. */
  | "track"
  /** A dedicated capture of the picked device, handed with `start(track)`. */
  | "capture";

export interface EngineFacts {
  /** The browser's brand, from browserBrand(). */
  brand: string;
  /** Whether the engine exposes the static `available()` beside track support. */
  available: boolean;
}

/** Edge, by its own name: the one Chromium whose speech backend is not Chromium's. */
export function isEdgeBrand(brand: string | null | undefined): boolean {
  return /\bedge\b/i.test(brand ?? "");
}

/** How to feed this engine so it hears the picked microphone. */
export function recognizerInputMode(facts: Pick<EngineFacts, "brand">): RecognizerInputMode {
  return isEdgeBrand(facts.brand) ? "capture" : "track";
}

/**
 * Whether the recogniser hears the device the member picked: on Edge through
 * its own capture of that device, elsewhere only where the engine honours the
 * track it is handed. Anything else is listening to the system default, and
 * the room must say so (transcriptionMicNotice).
 */
export function recognizerHearsPickedMic(facts: EngineFacts): boolean {
  return isEdgeBrand(facts.brand) || facts.available;
}

/**
 * The device to open a dedicated capture on: the call track's settled device
 * (what the browser actually opened, which is the truth after a fallback),
 * else the member's pick, else nothing — and nothing means the browser's own
 * choice, which is the default.
 */
export function captureDeviceFor(
  trackDeviceId: string | null | undefined,
  selectedMicId: string | null | undefined,
): string | null {
  const settled = (trackDeviceId ?? "").trim();
  if (settled) return settled;
  const picked = (selectedMicId ?? "").trim();
  return picked || null;
}

/**
 * Constraints for the recogniser's own capture.
 *
 * Processing OFF: this is what a bare `start()` gets from the engine's own
 * capture, which is the input Edge transcribed well. The call's track keeps
 * its echo cancellation; this one is heard by nobody but the recogniser, and
 * a peer's voice reaching it through the speakers is the attribution rule's
 * job to drop (speaker-attribution.ts), as it was before the track was handed.
 */
export function captureConstraints(deviceId: string | null): MediaTrackConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return audio;
}

/**
 * Whether an open capture can be reused for this device, or must be reopened.
 * Reopened on a device change (the member switched microphones) and when the
 * track has ended (unplugged, or stopped by the OS).
 */
export function captureReusable(
  current: { deviceId: string | null; readyState: string } | null,
  deviceId: string | null,
): boolean {
  if (!current) return false;
  if (current.readyState !== "live") return false;
  return (current.deviceId ?? null) === (deviceId ?? null);
}
