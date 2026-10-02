// lib/meetings/devices.ts
// Choosing cameras, microphones and speakers, and metering a mic level.
//
// Pure: no navigator, no DOM. The browser calls belong in the component, so
// the rules here — which device to pick, what to call one with no label, how
// loud is "loud" — can be tested without a media stack.

import { isDefaultSink } from "@/lib/meetings/echo";

export type DeviceKind = "audioinput" | "videoinput" | "audiooutput";

export interface Device {
  deviceId: string;
  kind: DeviceKind;
  label: string;
  groupId: string;
}

/** Where a member's device choice is remembered between calls. */
export const DEVICE_PREF_KEYS: Record<DeviceKind, string> = {
  audioinput: "fundexecs.device.mic",
  videoinput: "fundexecs.device.camera",
  audiooutput: "fundexecs.device.speaker",
};

const KIND_FALLBACK: Record<DeviceKind, string> = {
  audioinput: "Microphone",
  videoinput: "Camera",
  audiooutput: "Speaker",
};

/**
 * Devices of one kind, deduplicated and labelled.
 *
 * Before permission is granted the browser returns entries with empty labels —
 * that is the spec, not a bug. Numbering them ("Microphone 2") at least lets
 * someone distinguish two devices while they decide whether to allow access.
 */
export function devicesOfKind(devices: Device[], kind: DeviceKind): Device[] {
  const seen = new Set<string>();
  const out: Device[] = [];

  for (const d of devices) {
    if (d.kind !== kind) continue;
    // A duplicate deviceId is the same physical device reported twice; keeping
    // both would put two identical rows in the picker.
    if (seen.has(d.deviceId)) continue;
    seen.add(d.deviceId);
    out.push({ ...d, label: d.label?.trim() || `${KIND_FALLBACK[kind]} ${out.length + 1}` });
  }

  return out;
}

/**
 * Which device to start with.
 *
 * Order matters: a remembered choice beats the system default, because a member
 * who picked their headset last time meant it. A remembered device that is no
 * longer plugged in is ignored rather than honoured into a black preview.
 */
export function pickDevice(devices: Device[], kind: DeviceKind, remembered: string | null): Device | null {
  const candidates = devicesOfKind(devices, kind);
  if (!candidates.length) return null;

  if (remembered) {
    const match = candidates.find((d) => d.deviceId === remembered);
    if (match) return match;
  }

  const systemDefault = candidates.find((d) => d.deviceId === "default");
  return systemDefault ?? candidates[0];
}

/**
 * What to ask getDisplayMedia for.
 *
 * The request used to be a bare `{ video: true }`, which means "whatever this
 * display is" — and on a 4K monitor that is a 3840x2160 source captured at
 * whatever rate the compositor runs, re-encoded continuously, and on a mesh
 * call uploaded to every other participant. The send caps bound what goes on
 * the wire; they do nothing about what it costs to capture and encode in the
 * first place, which is paid by the one machine that can least afford it: the
 * one also running the meeting, the presentation, and whatever is being shown.
 *
 * Frame rate is the lever, not resolution. Shared screens are overwhelmingly
 * static — a document, a deck, a spreadsheet — so halving the rate halves the
 * encoder's work and costs nothing anybody can see. Resolution is left alone
 * on purpose: it is what makes text readable, and a screen share nobody can
 * read is not a cheaper screen share, it is a failed one.
 *
 * `ideal` rather than `max` throughout, so a browser that cannot honour one of
 * these gives its best rather than refusing: an OverconstrainedError here
 * reaches the member as a share button that does nothing.
 */
export function displayConstraints(): DisplayMediaStreamOptions {
  return {
    video: {
      frameRate: { ideal: SCREEN_SHARE_FPS },
      // Height only, so the aspect ratio of whatever surface they picked is
      // left to the browser. See SCREEN_SHARE_MAX_HEIGHT for why there is a
      // ceiling at all, and why it is `ideal`.
      height: { ideal: SCREEN_SHARE_MAX_HEIGHT },
    },
    // Not requested. Routing tab audio into the call needs a second outgoing
    // track and a decision about whether it is mixed with the presenter's
    // microphone or sent beside it, and asking for it without carrying it
    // anywhere would light the "sharing audio" indicator while sending silence.
    audio: false,
  };
}

/** Frames a second to capture a shared screen at. */
export const SCREEN_SHARE_FPS = 15;

/**
 * The tallest capture worth taking from a shared screen.
 *
 * There used to be no ceiling, on the reasoning that resolution is what makes
 * text readable — which is true, and is exactly why the unbounded version
 * defeated itself. A 5K panel was captured at 5120x2880 and handed to an
 * encoder that `screenSendCap` forbids to scale, on a mesh budget that at four
 * peers is about 600kbps. Nothing in that chain can produce readable text: the
 * pixels are kept and the legibility they were kept for is spent on them.
 * 1440p is past the point where a shared document is comfortable to read and
 * an order of magnitude cheaper to encode.
 *
 * `ideal`, never `max`: a browser that cannot deliver this must hand back what
 * it has rather than reject the request, because an OverconstrainedError here
 * reaches the member as a share button that does nothing. When the capture
 * does come back larger, the encoder-side ladder in `screenSendCap` is the
 * second line of defence.
 */
export const SCREEN_SHARE_MAX_HEIGHT = 1440;

/**
 * The capture bounds every camera this app opens is held to.
 *
 * In one place because having them in two is what went wrong: `switchCam`
 * carried them with a comment explaining why, and `flipCamera` -- fifty lines
 * away, doing the same job -- asked for `{ facingMode }` and nothing else. On a
 * phone that is the worst possible omission, because the rear camera is the
 * HIGHEST-resolution sensor on the device: flipping to it opened a 4K 60fps
 * capture, on a mesh call where every participant uploads a copy to every
 * other.
 *
 * Nothing downstream rescues that. `videoSendCap` sets
 * `scaleResolutionDownBy: 1` at any healthy bitrate, so the encoder is told to
 * keep every one of those pixels; and the masking pipeline is handed frames at
 * twice the rate its per-frame filters were measured at.
 *
 * 720p is the ceiling worth sending on a mesh: every participant uploads a copy
 * to every other, so doubling resolution multiplies across the call.
 */
function cameraBounds(): MediaTrackConstraints {
  return {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
  };
}

/**
 * Stop every track in a stream nobody took ownership of.
 *
 * The three paths that open a device mid-call -- `switchMic`, `switchCam`,
 * `flipCamera` -- each have to release what they opened if the hand-over does
 * not complete, and each wrote its own `forEach(x => x.stop())`. Two of them
 * covered only the early return and not a throw, which leaves a live capture
 * and the hardware light on; and none of them guarded `stop()` itself, so a
 * track that was already ended turned a clean release into the catch block's
 * "that camera could not be opened".
 *
 * The caller still decides WHETHER to release. That decision is the one thing
 * this cannot know: once a track has been adopted it belongs to the room, and
 * stopping it then would kill the camera the member is now using.
 */
export function releaseStream(stream: { getTracks(): MediaStreamTrack[] } | null | undefined): void {
  if (!stream) return;
  let tracks: MediaStreamTrack[];
  try { tracks = stream.getTracks(); } catch { return; }
  for (const track of tracks) {
    try { track.stop(); } catch { /* already stopped */ }
  }
}

/**
 * Constraints for flipping between the front and rear cameras.
 *
 * `facingMode` is left as a plain value rather than `{ exact }` on purpose. An
 * exact match throws OverconstrainedError on any machine with one camera, and
 * for a flip button a failed open is worse than getting the same camera back --
 * so this asks, and the caller reads `getSettings().facingMode` to find out
 * what it actually got. See `settledFacing`.
 */
export function facingConstraints(facing: "user" | "environment"): MediaTrackConstraints {
  const video = cameraBounds();
  video.facingMode = facing;
  return video;
}

/**
 * Which camera a flip actually landed on.
 *
 * Because `facingConstraints` asks rather than demands, a flip on a one-camera
 * machine comes back with the same camera -- and recording the side that was
 * REQUESTED would leave the button claiming you are on the rear camera while
 * your face is on screen. The browser's own answer wins; the request is only
 * the fallback for a browser that does not report one.
 */
export function settledFacing(
  reported: string | null | undefined,
  asked: "user" | "environment",
): "user" | "environment" {
  if (reported === "user" || reported === "environment") return reported;
  return asked;
}

/** Constraints for one chosen device, or the system default when none is chosen. */
export function constraintsFor(
  kind: "audioinput" | "videoinput",
  deviceId: string | null,
): MediaTrackConstraints | boolean {
  if (kind === "audioinput") {
    const audio: MediaTrackConstraints = {
      // Always on, and not configurable: a call is a conversation, not a
      // recording session, and these are what keep a laptop mic in a hard room
      // usable. There was an option here to turn noise suppression off and
      // nothing ever passed it — an unused switch reads as a feature that
      // exists, so it is gone rather than left implying one.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    return audio;
  }

  const video = cameraBounds();
  if (deviceId) video.deviceId = { exact: deviceId };
  return video;
}

/**
 * A mic level, 0–1, from raw time-domain samples.
 *
 * RMS rather than peak: peak jumps on a single click and reads as speech, which
 * makes a level meter that flickers at a keyboard and reassures nobody.
 */
export function levelFromSamples(samples: Float32Array | number[]): number {
  const n = samples.length;
  if (!n) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i];
    if (!Number.isFinite(v)) continue;
    sum += v * v;
  }

  const rms = Math.sqrt(sum / n);
  // Speech sits well below full scale, so raw RMS would leave the meter barely
  // moving. This maps a realistic speaking range onto the full bar.
  return Math.max(0, Math.min(1, rms * 4));
}

/**
 * Smooth a level for display.
 *
 * Rises fast and falls slowly, the way an audio meter should: catching the
 * start of a word matters, and a bar that drops instantly between syllables
 * reads as a broken microphone.
 */
export function smoothLevel(previous: number, next: number): number {
  const alpha = next > previous ? 0.5 : 0.12;
  return previous + (next - previous) * alpha;
}

/** How many bars of a segmented meter to light. */
export function levelBars(level: number, total = 12): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.max(1, Math.min(total, Math.round(level * total)));
}

export interface ReadinessProblem {
  kind: "no_camera" | "no_mic" | "camera_blocked" | "mic_blocked" | "mic_silent" | "camera_busy" | "mic_busy";
  message: string;
}

/** A peak at or under this, once the meter has settled, reads as a dead mic. */
export const MIC_SILENT_PEAK = 0.01;

/**
 * What is wrong before someone joins.
 *
 * The point of a green room is that these are discovered HERE rather than in
 * the first thirty seconds of the call, so each message says what to do rather
 * than merely what failed.
 */
export function readinessProblems(state: {
  cameraDenied: boolean;
  micDenied: boolean;
  cameras: number;
  mics: number;
  micPeak: number;
  cameraEnabled: boolean;
  micEnabled: boolean;
  /** The device is there and something else has it — not the same as absent. */
  cameraBusy?: boolean;
  micBusy?: boolean;
}): ReadinessProblem[] {
  const problems: ReadinessProblem[] = [];

  if (state.micDenied) {
    problems.push({
      kind: "mic_blocked",
      message: "Your browser is blocking the microphone. Allow it in the address bar, then reload.",
    });
  } else if (state.micBusy) {
    // Ranked above "none found", because it is a different instruction: the
    // microphone exists, and telling somebody to go and look for one they are
    // holding is how they end up joining a call they cannot be heard on.
    problems.push({
      kind: "mic_busy",
      message: "Another app is using your microphone. Close it, then pick your mic again.",
    });
  } else if (state.mics === 0) {
    problems.push({ kind: "no_mic", message: "No microphone found. Others won't hear you." });
  } else if (state.micEnabled && state.micPeak <= MIC_SILENT_PEAK) {
    // Only after the meter has had a chance to see something: a member who is
    // simply not talking yet must not be told their mic is dead.
    problems.push({
      kind: "mic_silent",
      message: "That microphone isn't picking anything up. Try another one.",
    });
  }

  if (state.cameraDenied) {
    problems.push({
      kind: "camera_blocked",
      message: "Your browser is blocking the camera. Allow it in the address bar, then reload.",
    });
  } else if (state.cameraBusy && state.cameraEnabled) {
    problems.push({
      kind: "camera_busy",
      message: "Another app is using your camera. Close it, then turn your camera off and on again.",
    });
  } else if (state.cameras === 0 && state.cameraEnabled) {
    problems.push({ kind: "no_camera", message: "No camera found. You can still join with audio." });
  }

  return problems;
}

/** Whether joining is worth allowing at all. Audio is the floor for a call. */
export function canJoin(state: { micDenied: boolean; mics: number }): boolean {
  // A member with no working mic can still listen, so this never blocks —
  // it exists so the button can say "Join to listen" rather than lie.
  return !(state.micDenied && state.mics === 0);
}

// ── Routing call audio to the chosen speaker ─────────────────────────────────

/** The part of a media element the routing rule reads. */
export interface SinkableElement {
  /** A live MediaStream means this is call media; a `src` URL means it is not. */
  srcObject: unknown;
  /** A muted element renders nothing, so its sink is immaterial. */
  muted: boolean;
  /** The device it is currently routed to. `""` means the system default. */
  sinkId?: string;
  setSinkId?: (id: string) => Promise<void>;
}

/**
 * Whether this element actually needs re-routing to `deviceId`.
 *
 * The room used to ask `document.querySelectorAll("video, audio")` and await
 * `setSinkId` on every result in turn, on every change to the roster. Three
 * things were wrong with that and all three cost something real:
 *
 *  1. **It was the whole document.** Any other media on the page — a player on
 *     a route rendered behind the call, a background clip — was re-routed too.
 *     Call media is identifiable: it carries a `srcObject`, and nothing else
 *     does.
 *
 *  2. **It included the local tile, which is muted.** The local tile renders no
 *     audio at all; that is what stops a member hearing themselves. Routing it
 *     is an audio-pipeline rebuild for an element that will never play.
 *
 *  3. **The "already there" check never fired for the system default.** A
 *     never-routed element reports `sinkId === ""`, while the chosen id is a
 *     concrete string even when the member picked the entry labelled Default.
 *     So the comparison failed every time and every element was rebuilt on
 *     every roster change, which is precisely what the check existed to
 *     prevent. `isDefaultSink` collapses both spellings.
 */
export function needsSinkChange(el: SinkableElement, deviceId: string): boolean {
  if (typeof el.setSinkId !== "function") return false;
  // Not call media.
  if (!el.srcObject) return false;
  // Renders no audio, so its sink is immaterial.
  if (el.muted) return false;
  // Both the empty string and "default" mean the system default, so a member
  // who picked "Default" is not re-routed away from where they already are.
  if (isDefaultSink(el.sinkId) && isDefaultSink(deviceId)) return false;
  return el.sinkId !== deviceId;
}
