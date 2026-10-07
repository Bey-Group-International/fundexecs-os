// lib/meetings/camera-liveness.ts
// Whether the camera is actually doing what the room says it is doing.
//
// Written for a reported failure with no single reproducible cause: a member
// configures their camera in the green room, the meeting starts, and the camera
// is not live — for them or for anyone — until they open the device settings and
// pick the same camera again. It happens on every join path, with and without a
// background effect.
//
// There are at least four ways to arrive at that state, and they are not
// distinguishable from the outside:
//
//   - The camera was never opened. The green room's tracks were stopped and the
//     same device asked for again milliseconds later, and the driver had not
//     finished letting go. openCallMedia retries once; some hardware needs
//     longer than that.
//   - The camera was opened and had already ended by the time the room rendered.
//   - The camera is open and DISABLED. The background hold disables the track
//     until the segmenter builds, and every route out of that is supposed to
//     re-enable it. Any route that does not leaves a live camera sending
//     nothing, with a UI that says it is on.
//   - Something adopted a track that was never live to begin with.
//
// Rather than guess which, the room asks a plain question a couple of seconds
// after joining: is the camera the member asked for actually producing? If not,
// it fixes it, which is what the member would have done by hand.
//
// The check is deliberately late and deliberately one-shot. Late, because a
// freshly opened track reports `muted` for a moment before the first frame and
// judging it immediately would condemn a camera that is merely starting.
// One-shot, because this is a safety net under a path that is supposed to work,
// not a supervisor — anything still wrong after it is the re-acquisition loop's
// business, and anything that breaks later is the device-loss listener's.
//
// Pure: no tracks, no timers. The room supplies what it sees.

/** What the room can observe about its own camera, without acting on it. */
export interface CameraFacts {
  /** The member asked for a camera — they did not join with it off. */
  wanted: boolean;
  /** What the controls claim, which is what every other participant was told. */
  on: boolean;
  /** The outgoing camera track, or null if there is none. */
  track: { readyState: string; enabled: boolean } | null;
}

export type CameraVerdict =
  /** Producing, as far as anything here can tell. */
  | "live"
  /** No camera was wanted. Not a fault. */
  | "not_wanted"
  /** Wanted, and there is no track at all. */
  | "no_track"
  /** There is a track and it has stopped. */
  | "dead_track"
  /** Open, alive, and switched off while the room insists it is on. */
  | "disabled";

/**
 * What the camera is really doing.
 *
 * `disabled` is the one worth naming separately, because it is the only state
 * that is both silent and cheap to fix: the device is open and working, and
 * somebody along the way left `enabled` false. Reopening it would work and
 * would also blink the camera light and cost a second for no reason.
 *
 * `on` is not consulted for the other verdicts. A member whose camera died
 * while the controls still say "on" has the same problem whichever way that
 * flag points, and the flag is the less trustworthy of the two.
 */
export function cameraVerdict(facts: CameraFacts): CameraVerdict {
  if (!facts.wanted) return "not_wanted";
  if (!facts.track) return "no_track";
  if (facts.track.readyState !== "live") return "dead_track";
  if (facts.on && !facts.track.enabled) return "disabled";
  return "live";
}

/** Whether the room should do something about it. */
export function needsRepair(verdict: CameraVerdict): boolean {
  return verdict === "no_track" || verdict === "dead_track" || verdict === "disabled";
}

/**
 * The cheapest repair that can work.
 *
 * A track that is open and merely switched off needs a flag set, not a device
 * opened: reopening would blink the camera light in front of somebody who is
 * already looking at their own face, and would cost a second of black on every
 * other participant's tile for a fault that takes no time at all to correct.
 */
export function repairFor(verdict: CameraVerdict): "enable" | "reopen" | "none" {
  if (verdict === "disabled") return "enable";
  if (verdict === "no_track" || verdict === "dead_track") return "reopen";
  return "none";
}

/**
 * How long after joining to look.
 *
 * Long enough that a camera which is merely slow to start is not mistaken for
 * one that failed — the background hold, in particular, is expected to be
 * released the moment the segmenter builds, and that is a download. Short
 * enough that a member does not spend the opening of their meeting invisible.
 */
export const CAMERA_CHECK_MS = 2_500;

/**
 * How long a camera may stop producing frames before the member is told.
 *
 * The third way a camera fails, beside never starting (the check above) and
 * ending (the device-loss listener): it STALLS. Windows hands the device to
 * another application, a privacy shutter closes, a driver wedges — the track
 * stays `live` and fires `mute`, the encoder keeps the last frame it was
 * given, and every tile in the room freezes on it. The person it happens to
 * is looking at the same frozen frame and has no way to know the room is too.
 *
 * Sustained for a few seconds before anything is said: some hardware blips
 * `mute` for a frame around focus and exposure changes, and a notice that
 * flashes on every blip teaches people to dismiss it unread. It withdraws
 * itself the moment frames resume.
 */
export const CAMERA_STALL_MS = 4_000;

/** What the member is told. Names the causes they can actually act on. */
export const CAMERA_STALL_NOTICE =
  "Your camera has stopped sending video — another app may have taken it over, or a privacy "
  + "shutter is closed. Everyone sees a frozen frame until it comes back. The arrow beside the "
  + "camera button switches cameras.";
