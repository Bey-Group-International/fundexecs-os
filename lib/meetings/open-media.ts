// lib/meetings/open-media.ts
// Opening a camera and a microphone for a call, and saying which ones opened.
//
// The one impure module in this pair, and it is impure only in the sense that
// it calls out: every decision it makes comes from media-acquisition.ts, and
// the browser reaches it through an injected gateway rather than through
// `navigator`. That is what makes "the camera was busy, so we took the other
// one, and the microphone was never the problem" a thing that can be tested
// instead of a thing that has to be reproduced with two applications fighting
// over a webcam.
//
// It deliberately returns TRACKS rather than a MediaStream. The room knows what
// it wants to build from them, and a function that constructs one cannot run
// anywhere but a browser.
//
// The shape of the sequence matters as much as the rules:
//
//   1. Ask for both together. This is the common path and it must stay a SINGLE
//      permission prompt — a member joining a meeting should not be asked twice.
//   2. If that fails, ask for them apart. A combined request fails whole, so
//      one unavailable camera used to cost the microphone as well.
//   3. Within each, walk the candidates in order of intent, retrying a device
//      that is merely busy once before moving on.

import { constraintsFor, devicesOfKind, type Device, type DeviceKind } from "./devices";
import {
  RETRY_SAME_DEVICE_MS,
  canRetrySameDevice,
  canTryAnotherDevice,
  classifyMediaError,
  deviceAttemptOrder,
  type AcquisitionOutcome,
  type DeviceOutcome,
  type MediaFailure,
} from "./media-acquisition";

/** The browser surface this needs, named so a test can supply it. */
export interface MediaGateway {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  /** Injected so the retry delay does not make tests wait for real time. */
  wait(ms: number): Promise<void>;
}

export const browserMediaGateway: MediaGateway = {
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface OpenedMedia extends AcquisitionOutcome {
  cameraTrack: MediaStreamTrack | null;
  micTrack: MediaStreamTrack | null;
}

const NOTHING: DeviceOutcome = { deviceId: null, fellBack: false, failure: null };

/**
 * The id a track is really running on.
 *
 * `getSettings().deviceId` rather than the id we asked for, because they differ
 * exactly when it matters: a request for "default" resolves to a concrete
 * device, and a picker that shows what was requested rather than what is live
 * tells a member they are on their headset while they talk into their laptop.
 */
function settledId(track: MediaStreamTrack | null, requested: string): string | null {
  if (!track) return null;
  try {
    return track.getSettings().deviceId || requested || "";
  } catch {
    return requested || "";
  }
}

/** Whether what opened is something other than what the member asked for. */
function isFallback(requested: string, opened: string | null, track: MediaStreamTrack | null): boolean {
  if (!track || opened === null) return false;
  // Nothing was asked for, so nothing was overridden. "default" counts as
  // nothing: it is a request for whatever the system considers current, and it
  // resolves to a concrete id by design — reading that resolution as a fallback
  // would tell almost every member on Windows that their usual camera was
  // unavailable while they sit looking at it.
  if (!requested || requested === "default") return false;
  return opened !== requested;
}

async function openOne(
  kind: "audioinput" | "videoinput",
  requested: string,
  remembered: string | null,
  available: readonly Device[],
  gateway: MediaGateway,
): Promise<{ track: MediaStreamTrack | null; outcome: DeviceOutcome }> {
  const order = deviceAttemptOrder({ requested: requested || null, remembered, available });
  // Why the FIRST attempt failed, which is the one worth reporting: a member
  // whose chosen camera is held by another app wants to hear that, not that
  // the fourth camera on the list is missing.
  let firstFailure: MediaFailure | null = null;

  for (const id of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const stream = await gateway.getUserMedia(
          kind === "videoinput"
            ? { video: constraintsFor("videoinput", id || null), audio: false }
            : { audio: constraintsFor("audioinput", id || null), video: false },
        );
        const track = (kind === "videoinput" ? stream.getVideoTracks() : stream.getAudioTracks())[0] ?? null;
        if (!track) {
          // A stream with no track of the kind asked for. Release it rather
          // than leaving a device held open by nothing.
          stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
          break;
        }
        const opened = settledId(track, id);
        return {
          track,
          outcome: {
            deviceId: opened,
            // Measured against what the member ASKED for, not against which
            // candidate in the walk won. Falling through to a remembered device
            // when nothing was requested is not a fallback — it is the
            // preference doing its job, and saying otherwise would tell someone
            // their usual camera was unavailable while they are looking at it.
            fellBack: isFallback(requested, opened, track),
            failure: firstFailure,
          },
        };
      } catch (err) {
        const failure = classifyMediaError(err);
        if (firstFailure === null) firstFailure = failure;
        if (!canTryAnotherDevice(failure)) return { track: null, outcome: { ...NOTHING, failure } };
        // One more go at the same device before moving on, but only for the
        // failures that are about timing rather than about the device.
        if (attempt === 0 && canRetrySameDevice(failure)) {
          await gateway.wait(RETRY_SAME_DEVICE_MS);
          continue;
        }
        break;
      }
    }
  }

  return { track: null, outcome: { ...NOTHING, failure: firstFailure ?? "missing" } };
}

/** Enumerate, tolerating a browser that refuses to. */
async function knownDevices(gateway: MediaGateway): Promise<Device[]> {
  try {
    const all = await gateway.enumerateDevices();
    return all.map((d) => ({
      deviceId: d.deviceId,
      kind: d.kind as DeviceKind,
      label: d.label,
      groupId: d.groupId,
    }));
  } catch {
    // No enumeration is no reason to stop: deviceAttemptOrder still ranks the
    // ids we already know about, which is where the good guesses live anyway.
    return [];
  }
}

/**
 * Open a camera, and nothing else.
 *
 * For turning the camera ON during a call, which is not the same problem as
 * joining one: the microphone is already live and must not be touched, and the
 * member is watching the button they just pressed. The same walk applies — the
 * camera they were last on, the one they usually use, the system default, then
 * whatever else is plugged in — because the commonest reason this is being
 * pressed at all is that the camera was busy when they joined.
 */
export async function openCameraOnly(input: {
  cameraId: string;
  rememberedCameraId: string | null;
  gateway?: MediaGateway;
}): Promise<{ track: MediaStreamTrack | null; outcome: DeviceOutcome }> {
  const gateway = input.gateway ?? browserMediaGateway;
  const devices = await knownDevices(gateway);
  return openOne(
    "videoinput",
    input.cameraId,
    input.rememberedCameraId,
    devicesOfKind(devices, "videoinput"),
    gateway,
  );
}

/**
 * Open the devices for a call.
 *
 * `wantCamera: false` means the camera is never opened — not opened and
 * disabled. The hardware light staying dark is the whole point of joining with
 * the camera off, and it is also the only state in which "no camera" is not a
 * failure worth a message.
 */
export async function openCallMedia(input: {
  wantCamera: boolean;
  cameraId: string;
  micId: string;
  rememberedCameraId: string | null;
  rememberedMicId: string | null;
  gateway?: MediaGateway;
}): Promise<OpenedMedia> {
  const gateway = input.gateway ?? browserMediaGateway;
  const { wantCamera, cameraId, micId } = input;

  // 1. Both at once: one prompt, and the path almost every join takes.
  try {
    const stream = await gateway.getUserMedia({
      video: wantCamera ? constraintsFor("videoinput", cameraId || null) : false,
      audio: constraintsFor("audioinput", micId || null),
    });
    const cameraTrack = stream.getVideoTracks()[0] ?? null;
    const micTrack = stream.getAudioTracks()[0] ?? null;
    if (micTrack && (!wantCamera || cameraTrack)) {
      const camOpened = settledId(cameraTrack, cameraId);
      const micOpened = settledId(micTrack, micId);
      return {
        cameraTrack,
        micTrack,
        cameraWanted: wantCamera,
        camera: cameraTrack
          ? { deviceId: camOpened, fellBack: isFallback(cameraId, camOpened, cameraTrack), failure: null }
          : NOTHING,
        microphone: { deviceId: micOpened, fellBack: isFallback(micId, micOpened, micTrack), failure: null },
      };
    }
    // A success that is missing one of the two. Release it and take the split
    // path, which can at least say which device is the problem.
    stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
  } catch {
    // Deliberately not classified here. A combined refusal does not say WHICH
    // device was refused, and the split attempts below find out by asking.
  }

  // 2. Apart. Enumerate first so the walk has real candidates.
  const devices = await knownDevices(gateway);

  // The microphone first, and unconditionally. It is the one device a meeting
  // cannot do without, and the reason this function exists is that it used to
  // be lost to a camera that had nothing to do with it.
  const mic = await openOne(
    "audioinput",
    micId,
    input.rememberedMicId,
    devicesOfKind(devices, "audioinput"),
    gateway,
  );

  if (!wantCamera) {
    return {
      cameraTrack: null,
      micTrack: mic.track,
      cameraWanted: false,
      camera: NOTHING,
      microphone: mic.outcome,
    };
  }

  const cam = await openOne(
    "videoinput",
    cameraId,
    input.rememberedCameraId,
    devicesOfKind(devices, "videoinput"),
    gateway,
  );

  return {
    cameraTrack: cam.track,
    micTrack: mic.track,
    cameraWanted: true,
    camera: cam.outcome,
    microphone: mic.outcome,
  };
}
