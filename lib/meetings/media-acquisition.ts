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

// ── Taking over the green room's devices ─────────────────────────────────────

// The green room opens the camera and the microphone so somebody can check
// themselves before anyone can see them. The call then stopped both and opened
// the same two devices again, a few milliseconds later.
//
// That reopen is the most expensive thing on the join path and the least
// necessary. It costs a few hundred milliseconds on a laptop and considerably
// more on Windows; it blinks the camera light off and on at the moment the
// member is watching their own face; and it is a race the room can lose,
// because a camera released a moment ago is often still held when it is asked
// for again — which is the entire reason the retry above exists.
//
// So the call takes the tracks instead, when they are the ones it would have
// opened. The check is what makes that safe: adopting a track that is not the
// device the member chose would put them on the wrong camera for the call,
// silently, which is worse than the delay this avoids.

/** What a live preview track is, in the terms this decision needs. */
export interface PreviewFacts {
  /** `getSettings().deviceId` — what is really open, not what was asked for. */
  deviceId: string;
  readyState: string;
}

export type AdoptionReason =
  /** Everything the call needs is already open and is the right device. */
  | "adopted"
  /** No live preview microphone, so there is nothing to take. */
  | "no_microphone"
  /** The preview is on a different microphone than the call was asked for. */
  | "microphone_mismatch"
  /** A camera is wanted and the preview has none live. */
  | "no_camera"
  /** The preview is on a different camera than the call was asked for. */
  | "camera_mismatch";

export interface PreviewAdoption {
  /** Take the preview's tracks rather than opening the devices again. */
  adopt: boolean;
  /** Carry the preview's camera into the call. False also means: stop it. */
  camera: boolean;
  reason: AdoptionReason;
}

/**
 * Whether a track is the device that was asked for.
 *
 * An empty request means "whatever the system considers current", which is
 * exactly what the green room opened when it was given the same empty request —
 * so anything live satisfies it. A named request has to match what is actually
 * open, read from the track rather than from what was requested, because those
 * differ precisely when it matters.
 */
function isRequestedDevice(requested: string, facts: PreviewFacts | null): boolean {
  if (!facts || facts.readyState !== "live") return false;
  if (!requested) return true;
  return facts.deviceId === requested;
}

/**
 * Whether the call can take the green room's devices as they are.
 *
 * The microphone decides it. A meeting can be joined without a camera and
 * frequently is, but a member with no microphone is sitting in a room nobody
 * knows they are in — so an adoption that cannot supply one is not an
 * optimisation, it is a silent failure, and the full open path (which knows how
 * to walk devices and report why) handles that case instead.
 *
 * `camera: false` with `adopt: true` is the ordinary "joining with my camera
 * off" case, and it carries an instruction: the preview's camera track is not
 * coming into the call and must be stopped, or the member joins with their
 * camera off and the light still on.
 */
export function planPreviewAdoption(input: {
  wantCamera: boolean;
  cameraId: string;
  micId: string;
  camera: PreviewFacts | null;
  microphone: PreviewFacts | null;
}): PreviewAdoption {
  if (!input.microphone || input.microphone.readyState !== "live") {
    return { adopt: false, camera: false, reason: "no_microphone" };
  }
  if (!isRequestedDevice(input.micId, input.microphone)) {
    return { adopt: false, camera: false, reason: "microphone_mismatch" };
  }

  if (!input.wantCamera) {
    // Nothing to check: no camera is wanted, and any the preview holds is
    // stopped rather than carried.
    return { adopt: true, camera: false, reason: "adopted" };
  }

  if (!input.camera || input.camera.readyState !== "live") {
    return { adopt: false, camera: false, reason: "no_camera" };
  }
  if (!isRequestedDevice(input.cameraId, input.camera)) {
    return { adopt: false, camera: false, reason: "camera_mismatch" };
  }

  return { adopt: true, camera: true, reason: "adopted" };
}
