// lib/meetings/camera-release.ts
// Letting go of a camera that has been switched off.
//
// "Camera off" used to mean `track.enabled = false` and nothing more: the
// device stayed open, its light stayed on, and the capture kept running at
// 720p thirty times a second into a sender that discarded every frame. To
// the person it looks like the camera is still watching them — because it
// is — and on a laptop it is a fan that never spins down during the hour
// they spend listening.
//
// Releasing the device is the only thing that turns the light off. The cost
// is that turning the camera back on has to reopen it, which takes half a
// second to a second and, on Windows, occasionally finds the device still
// held by the driver that just let it go. A member who taps off and straight
// back on — the commonest toggle there is, to check their hair — must not
// pay that. So the release waits: long enough that a quick off-and-on never
// reopens, short enough that "I'm done being on camera" goes dark while they
// can still see the light.
//
// Pure: the room owns the timer and the track. This decides when and whether.

/** How long the camera stays off before the device is released. */
export const CAMERA_RELEASE_MS = 10_000;

/**
 * Whether the camera should be released now.
 *
 * Only when the member has it off and has had it off for the whole wait;
 * never while a camera is being opened (the open would land on a device this
 * just stopped) and never when there is nothing to release.
 */
export function cameraReleaseDue(input: {
  /** The member's camera switch, as the room tracks it. */
  camOn: boolean;
  /** Whether the room holds an open camera device at all. */
  hasCamera: boolean;
  /** A camera open is in flight (join, switch, flip, recovery). */
  opening: boolean;
  /** When the camera was last switched off, or null if it is on. */
  offSinceMs: number | null;
  nowMs: number;
}): boolean {
  if (input.camOn || !input.hasCamera || input.opening) return false;
  if (input.offSinceMs === null) return false;
  return input.nowMs - input.offSinceMs >= CAMERA_RELEASE_MS;
}

/** How long to wait before checking again, from the moment it went off. */
export function msUntilCameraRelease(offSinceMs: number, nowMs: number): number {
  return Math.max(0, CAMERA_RELEASE_MS - (nowMs - offSinceMs));
}
