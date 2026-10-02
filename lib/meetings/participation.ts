// lib/meetings/participation.ts
// Whether a member is actually being seen and heard, as opposed to whether
// their buttons say so.
//
// These are two different facts and the room used to conflate them. A member
// with no microphone track at all -- permission denied, device held by another
// application, nothing plugged in -- rendered exactly like a member who had
// muted themselves: the same button, captioned "Unmute". Pressing it set
// `enabled = true` on an empty list of tracks, flipped the control to "on",
// cancelled the watcher that was trying to re-acquire the device, and
// broadcast `micOn: true` to the room.
//
// So the worst case was not silence. It was a guest who believed they were
// live, a host who had been told they were live, and a meeting waiting for
// somebody who could not speak to it. Nobody in that room had any way to find
// out, because every signal in the product agreed with the wrong answer.
//
// Hence a standing, not a boolean. "Off" and "cannot" are separate states, the
// button is only allowed to promise what it can deliver, and the notice that
// says so is DERIVED from the devices rather than stored -- so it cannot be
// dismissed while it is still true.

import type { MediaFailure } from "@/lib/meetings/media-acquisition";

/** What one of a member's own devices is really doing. */
export type Standing =
  /** Attached and transmitting. */
  | { standing: "live" }
  /**
   * Attached, not transmitting, by the member's own choice. Reversible by them,
   * at once, which is what separates it from the case below.
   */
  | { standing: "muted" }
  /**
   * No track at all. The member cannot fix this by pressing the button, and
   * until now the button let them think they could.
   */
  | { standing: "unavailable"; failure: MediaFailure | null };

/** What the room knows about one outgoing device. */
export interface TrackFacts {
  /** A track of this kind is attached to the outgoing stream. */
  present: boolean;
  /** `track.enabled`: whether what is attached is being transmitted. */
  enabled: boolean;
  /** Why there is no track, when that is known. */
  failure: MediaFailure | null;
}

/**
 * Read a device's standing.
 *
 * `present` first, deliberately. A member who muted themselves and then had
 * their camera taken by another application is in the `unavailable` case, not
 * the `muted` one: what they chose stopped being the reason some time ago.
 */
export function standingOf(facts: TrackFacts): Standing {
  if (!facts.present) return { standing: "unavailable", failure: facts.failure };
  return facts.enabled ? { standing: "live" } : { standing: "muted" };
}

/**
 * Whether the mute / camera button can do what its caption says.
 *
 * The one rule that stops the interface lying. With no track there is nothing
 * to enable, so the press must mean "try to get the device back" rather than
 * "you are now on" -- and must not broadcast that the member is live.
 */
export function toggleCanDeliver(standing: Standing): boolean {
  return standing.standing !== "unavailable";
}

/** What to call a device the member does not have, in a sentence. */
export type NoticeReason = "no-microphone" | "no-camera" | "neither";

export interface ParticipationNotice {
  /** Why, as a closed value, so this can be counted without parsing prose. */
  reason: NoticeReason;
  /** What the member is told. */
  text: string;
  /**
   * Whether re-asking the browser is worth offering.
   *
   * Always, when a device is missing: re-asking IS the remedy, including after
   * a denial, where the member allows the site in the address bar and the
   * retry is what picks that up. The text differs because the ORDER differs --
   * allow first, then retry -- not because the button would do nothing.
   */
  retry: boolean;
}

/**
 * The standing notice, or null when the member has what they asked for.
 *
 * Derived rather than stored, which is the point: a condition that is still
 * true cannot be dismissed into the background, and one that has ended
 * disappears without anybody having to remember to clear it.
 */
export function participationNotice(microphone: Standing, camera: Standing): ParticipationNotice | null {
  // Narrowed on the discriminant rather than on booleans derived from it, so
  // the failure each message needs is the one the compiler can see is there.
  const mic = microphone.standing === "unavailable" ? microphone : null;
  const cam = camera.standing === "unavailable" ? camera : null;
  if (!mic && !cam) return null;

  // The microphone leads whenever both are gone. A meeting survives a member
  // nobody can see; it does not survive one nobody can hear, and the member has
  // one address-bar decision to make either way.
  if (mic && cam) {
    return { reason: "neither", text: micFailureText(mic.failure, true), retry: true };
  }
  if (mic) {
    return { reason: "no-microphone", text: micFailureText(mic.failure, false), retry: true };
  }
  if (cam) {
    return { reason: "no-camera", text: camFailureText(cam.failure), retry: true };
  }
  // Unreachable: the guard above returns when neither is missing. Written out
  // rather than asserted away, because a `!` in this particular file would be
  // claiming something the compiler cannot check, which is the whole bug.
  return null;
}

function micFailureText(failure: MediaFailure | null, alsoCamera: boolean): string {
  const also = alsoCamera ? " and camera" : "";
  switch (failure) {
    case "denied":
      return `Nobody can hear you — your browser is blocking your microphone${also}. Allow it in the address bar, then press Retry.`;
    case "in_use":
      return `Nobody can hear you — another app is using your microphone${also}. Close it, then press Retry.`;
    case "missing":
      return `Nobody can hear you — no microphone${alsoCamera ? " or camera was" : " was"} found. Connect one, then press Retry.`;
    default:
      return `Nobody can hear you — your microphone${also} could not be started. Press Retry to try again.`;
  }
}

function camFailureText(failure: MediaFailure | null): string {
  switch (failure) {
    case "denied":
      return "Nobody can see you — your browser is blocking your camera. Allow it in the address bar, then press Retry.";
    case "in_use":
      return "Nobody can see you — another app is using your camera. Close it, then press Retry.";
    case "missing":
      return "Nobody can see you — no camera was found. Connect one, then press Retry.";
    default:
      return "Nobody can see you — your camera could not be started. Press Retry to try again.";
  }
}

/**
 * What the mute button should say.
 *
 * Separated from the icon because the icon has always been right -- a crossed
 * microphone is correct whether the member chose it or the hardware did -- and
 * it was the caption and the press that were wrong.
 */
export function micButtonTitle(standing: Standing): string {
  if (standing.standing === "unavailable") return "No microphone — retry";
  return standing.standing === "live" ? "Mute" : "Unmute";
}

/** The same, for the camera. */
export function camButtonTitle(standing: Standing): string {
  if (standing.standing === "unavailable") return "No camera — retry";
  return standing.standing === "live" ? "Turn camera off" : "Turn camera on";
}
