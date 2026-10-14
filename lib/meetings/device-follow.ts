// lib/meetings/device-follow.ts
// Following a headset that is plugged in during a call.
//
// Plugging in a headset mid-call used to do nothing but add a row to the
// device picker. The operating system moves its own default to the new
// device at once, but the call holds concrete device ids — the laptop mic it
// opened at join, the speaker it was routed to — so the member who put on a
// headset to stop the echo kept talking into the laptop and hearing the room
// through its speakers, with the picker as the only clue. Native clients,
// Meet and Zoom all switch to the new device and say so, with a way back.
//
// So the room switches too, and says so, and offers one tap to undo. Only a
// device that APPEARED is followed: the first enumeration of the call is a
// baseline, not an arrival, and a device the system merely re-lists (a
// default-device change re-fires devicechange) is not new.
//
// Pure: the room enumerates and keeps the baseline; this decides.

import type { Device } from "@/lib/meetings/devices";

/** Aliases the browser adds for the system's choice; never a device of their own. */
function isAlias(deviceId: string): boolean {
  return deviceId === "" || deviceId === "default" || deviceId === "communications";
}

/**
 * The devices in `after` that were not in `before`, by id.
 *
 * Aliases and unlabelled entries are not arrivals: an alias moves to whatever
 * the system picked, and an entry with no label is a list read before
 * permission, which is not a device anyone plugged in.
 */
export function newlyPluggedDevices(
  before: readonly Pick<Device, "deviceId" | "kind" | "label" | "groupId">[],
  after: readonly Pick<Device, "deviceId" | "kind" | "label" | "groupId">[],
): Pick<Device, "deviceId" | "kind" | "label" | "groupId">[] {
  const known = new Set(before.map((d) => d.deviceId));
  return after.filter((d) => !known.has(d.deviceId) && !isAlias(d.deviceId) && d.label.trim().length > 0);
}

export interface FollowDecision {
  /** The microphone to switch to, or null to keep the current one. */
  micId: string | null;
  /** The speaker to route to, or null to keep the current one. */
  speakerId: string | null;
  /** What to call it in the notice. */
  label: string;
}

/**
 * Which of the new devices to follow.
 *
 * A headset is a microphone and a speaker that share a `groupId`; when one
 * arrives both sides move together, so the member is not left talking into
 * the headset and hearing the laptop. A microphone alone (a USB conference
 * mic) moves only the microphone; a speaker alone (a Bluetooth speaker)
 * moves only the output. A device that is already in use is not a switch.
 *
 * Null when nothing new is worth following.
 */
export function followDecision(input: {
  added: readonly Pick<Device, "deviceId" | "kind" | "label" | "groupId">[];
  currentMicId: string;
  currentSpeakerId: string;
}): FollowDecision | null {
  const mic = input.added.find((d) => d.kind === "audioinput") ?? null;
  const speaker = input.added.find((d) => d.kind === "audiooutput" && (!mic || !mic.groupId || d.groupId === mic.groupId))
    ?? input.added.find((d) => d.kind === "audiooutput")
    ?? null;
  const micId = mic && mic.deviceId !== input.currentMicId ? mic.deviceId : null;
  const speakerId = speaker && speaker.deviceId !== input.currentSpeakerId ? speaker.deviceId : null;
  if (!micId && !speakerId) return null;
  const label = (mic?.label ?? speaker?.label ?? "").trim() || "the new device";
  return { micId, speakerId, label };
}

/** What the notice says, with the way back beside it. */
export function followNotice(decision: FollowDecision): string {
  const what = decision.micId && decision.speakerId
    ? "Your microphone and speaker moved to"
    : decision.micId ? "Your microphone moved to" : "Call audio moved to";
  return `${what} ${decision.label}.`;
}
