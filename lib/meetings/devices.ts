// lib/meetings/devices.ts
// Choosing cameras, microphones and speakers, and metering a mic level.
//
// Pure: no navigator, no DOM. The browser calls belong in the component, so
// the rules here — which device to pick, what to call one with no label, how
// loud is "loud" — can be tested without a media stack.

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

/** Constraints for one chosen device, or the system default when none is chosen. */
export function constraintsFor(
  kind: "audioinput" | "videoinput",
  deviceId: string | null,
  opts: { noiseSuppression?: boolean } = {},
): MediaTrackConstraints | boolean {
  if (kind === "audioinput") {
    const audio: MediaTrackConstraints = {
      // On by default: a call is a conversation, not a recording session, and
      // these are what keep a laptop mic in a hard room usable.
      echoCancellation: true,
      noiseSuppression: opts.noiseSuppression ?? true,
      autoGainControl: true,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    return audio;
  }

  const video: MediaTrackConstraints = {
    // 720p is the ceiling worth sending on a mesh: every participant uploads a
    // copy to every other, so doubling resolution multiplies across the call.
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
  };
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
  kind: "no_camera" | "no_mic" | "camera_blocked" | "mic_blocked" | "mic_silent";
  message: string;
}

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
}): ReadinessProblem[] {
  const problems: ReadinessProblem[] = [];

  if (state.micDenied) {
    problems.push({
      kind: "mic_blocked",
      message: "Your browser is blocking the microphone. Allow it in the address bar, then reload.",
    });
  } else if (state.mics === 0) {
    problems.push({ kind: "no_mic", message: "No microphone found. Others won't hear you." });
  } else if (state.micEnabled && state.micPeak <= 0.01) {
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
