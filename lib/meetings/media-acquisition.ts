// lib/meetings/media-acquisition.ts
// Deciding how to open a camera and a microphone when the first attempt fails.
//
// The room asked for both devices in one getUserMedia call and treated the
// result as all-or-nothing. A combined request fails WHOLE: one camera that
// another application already holds — Zoom left open, OBS, a Teams window in
// the background, or simply the green room's own preview a few milliseconds
// from being released — and the member lands in the meeting with an empty
// MediaStream. No camera, which was the actual problem, and no microphone,
// which was never broken at all, for the rest of the call. They can neither be
// seen nor heard, and nothing on screen says why.
//
// So the rules here are about what to do next, and they are not symmetric:
//
//   - a device that is DENIED cannot be helped by trying a different one; the
//     permission is per-origin, not per-camera.
//   - a device that is IN USE often can, either by a second camera or by the
//     same one a moment later — releasing a camera is asynchronous on Windows,
//     and reopening it immediately is a race the room loses roughly as often
//     as it wins.
//   - a device that is MISSING is a remembered id that has since been
//     unplugged, and the system default is the right next guess.
//
// And whatever opens, the room should know WHICH device it actually got, not
// which one it asked for. A fallback that nobody is told about is how a member
// ends up talking into the wrong microphone while the picker insists they are
// on their headset.
//
// Pure: no navigator, no DOM, no timers. open-media.ts makes the browser calls.

import type { Device } from "./devices";

/** Why a getUserMedia call failed, in terms of what can be done about it. */
export type MediaFailure =
  /** The browser or the OS refused. A different device is behind the same wall. */
  | "denied"
  /** The device exists but something else holds it. */
  | "in_use"
  /** No such device — usually a remembered id for hardware that is now gone. */
  | "missing"
  /** The device exists but cannot do what was asked of it. */
  | "overconstrained"
  /** The attempt was interrupted; the OS was busy or the page navigated. */
  | "aborted"
  | "unknown";

/**
 * What a DOMException from getUserMedia means.
 *
 * Names rather than instanceof: these arrive as DOMException in browsers, as
 * plain Errors from polyfills, and as neither in tests. The name is the only
 * part every source agrees on, and both the modern and the legacy spellings
 * are still in the wild.
 */
export function classifyMediaError(err: unknown): MediaFailure {
  const name = err instanceof Error ? err.name : typeof err === "string" ? err : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotReadableError":
    case "TrackStartError":
      return "in_use";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "missing";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "overconstrained";
    case "AbortError":
      return "aborted";
    default:
      return "unknown";
  }
}

/**
 * Whether a DIFFERENT device is worth trying.
 *
 * False for `denied` and that is the whole point of asking: walking four
 * cameras behind a refused permission prompt costs four failures and answers
 * nothing, and on some browsers re-asking is what gets an origin permanently
 * blocked.
 */
export function canTryAnotherDevice(failure: MediaFailure): boolean {
  return failure !== "denied";
}

/**
 * Whether the SAME device is worth trying again in a moment.
 *
 * Only for the two failures that are about timing rather than about the
 * device. The green room stops its preview tracks and the room opens the same
 * camera in the next statement; on Windows the driver has not finished letting
 * go, and the retry below is the difference between landing with a camera and
 * landing without one.
 */
export function canRetrySameDevice(failure: MediaFailure): boolean {
  return failure === "in_use" || failure === "aborted";
}

/** Long enough for a camera to be released, short enough not to delay a join. */
export const RETRY_SAME_DEVICE_MS = 350;

/**
 * How many devices to walk before giving up.
 *
 * A member with a capture card, a virtual camera and three USB webcams should
 * not spend the first ten seconds of a meeting watching each one fail.
 */
export const MAX_DEVICE_ATTEMPTS = 4;

/**
 * Which device ids to try, in order. `""` means "let the browser choose".
 *
 * The order is a ranking of intent. What the member picked in the green room
 * comes first, because they picked it. What they picked on an earlier call
 * comes next. Then the system default — the thing a native client falls back
 * to, and nearly always whatever the laptop switched to when the headset came
 * out. Only then the rest of the hardware, which is a guess, but a better one
 * than nothing.
 *
 * `available` may legitimately be empty: before permission is granted the
 * browser reports devices with blank ids, so the first two entries are kept
 * whether or not they appear in it.
 */
export function deviceAttemptOrder(input: {
  requested: string | null;
  remembered: string | null;
  available: readonly Device[];
}): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };

  if (input.requested) push(input.requested);
  if (input.remembered) push(input.remembered);
  // The system default, expressed as "no constraint" rather than as the id
  // "default": some browsers do not enumerate a device by that name, and an
  // exact constraint on an id that does not exist is an OverconstrainedError
  // where the plain request would have succeeded.
  push("");
  for (const d of input.available) if (d.deviceId) push(d.deviceId);

  return order.slice(0, MAX_DEVICE_ATTEMPTS);
}

/** What one kind of device ended up doing. */
export interface DeviceOutcome {
  /** The id actually opened, `""` for the system default, null for nothing. */
  deviceId: string | null;
  /** Whether that is something other than what was asked for. */
  fellBack: boolean;
  /** Why the asked-for device did not open, when it did not. */
  failure: MediaFailure | null;
}

export interface AcquisitionOutcome {
  camera: DeviceOutcome;
  microphone: DeviceOutcome;
  /** Whether a camera was wanted at all — "off" is not a failure. */
  cameraWanted: boolean;
}

/**
 * What to tell the member, or null when there is nothing worth saying.
 *
 * Ordered by what stops a meeting working. Being inaudible is worse than being
 * unseen — a member with no camera can still take part, and one with no
 * microphone is sitting in a room nobody knows they are in — so the microphone
 * speaks first and only one message is shown.
 *
 * A successful fallback is still worth a word. Someone whose audio quietly
 * moved to the laptop's built-in microphone because their interface was busy
 * needs to know that, or they will spend the call wondering why they sound
 * like that.
 */
export function microphoneMessage(failure: MediaFailure): string {
  switch (failure) {
    case "denied":
      return "Your browser is blocking the microphone. Allow it in the address bar, then rejoin.";
    case "in_use":
      return "Another app is using your microphone. Close it and pick your mic again from the arrow beside the mic button.";
    case "missing":
      return "No microphone found. Others won't be able to hear you.";
    default:
      return "Your microphone could not be opened. Pick another from the arrow beside the mic button.";
  }
}

/**
 * Why the camera did not open, for someone who is already in the meeting.
 *
 * Deliberately says the call itself is fine. A camera that will not start reads
 * as a broken meeting unless something says it is not one, and the member is
 * sitting there deciding whether to leave and come back.
 */
export function cameraMessage(failure: MediaFailure): string {
  switch (failure) {
    case "denied":
      return "Your browser is blocking the camera. Allow it in the address bar, then try again.";
    case "in_use":
      return "Another app is using your camera. Close it, then turn your camera on again.";
    case "missing":
      return "No camera found. Check that it's connected, then turn your camera on again.";
    default:
      return "Your camera could not be started. Try another from the arrow beside the camera button.";
  }
}

export function acquisitionMessage(outcome: AcquisitionOutcome): string | null {
  const mic = outcome.microphone;
  const cam = outcome.camera;

  if (!mic.deviceId && mic.failure) return microphoneMessage(mic.failure);

  if (outcome.cameraWanted && !cam.deviceId && cam.failure) {
    // At join time the reassurance is specifically that they ARE in the call,
    // which is not what cameraMessage says to somebody already in it.
    switch (cam.failure) {
      case "denied":
        return "Your browser is blocking the camera. You've joined with audio — allow the camera in the address bar and rejoin to be seen.";
      case "in_use":
        return "Another app is using your camera, so you've joined with audio only. Close it, then turn your camera on.";
      case "missing":
        return "No camera found. You've joined with audio only.";
      default:
        return "Your camera could not be opened, so you've joined with audio only.";
    }
  }

  if (mic.fellBack && cam.fellBack) return "Your usual camera and microphone weren't available, so we started the ones that were.";
  if (mic.fellBack) return "Your usual microphone wasn't available, so we started the one that was.";
  if (cam.fellBack) return "Your usual camera wasn't available, so we started the one that was.";

  return null;
}
