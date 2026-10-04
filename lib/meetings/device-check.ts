// lib/meetings/device-check.ts
// Proving a camera and a microphone work BEFORE somebody is let into a meeting.
//
// The green room has always shown this. It never required it: the Join button
// was disabled while the join was in flight and at no other time, and
// `canJoin` in ./devices carries a comment saying so on purpose — "this never
// blocks". Everything was discoverable and nothing was mandatory, so the
// commonest way to arrive in a call unheard was to walk straight past a screen
// that was already saying why.
//
// This makes it a gate, and only for invite-link GUESTS. They are the
// population that actually arrives with a blocked permission and no IT desk to
// ask: a host or a colleague who joins unheard has a teammate who will tell them
// within seconds, and a reason to be let in late is worse for them than a
// silent first minute. A guest has neither.
//
// TWO THINGS HAVE TO AGREE, which is the point and the cost. A measurement
// alone cannot see a lens cap, a camera pointed at a ceiling, or a microphone
// picking up a fan instead of a voice. A person's say-so alone is a button
// somebody in a hurry presses without looking. So a device passes only when the
// browser reports signal AND the person says the signal is of them. Either one
// on its own is a guarantee that does not hold.
//
// WHAT THIS DELIBERATELY DOES NOT TEST: the speaker. Nothing here plays a tone,
// so a guest can pass this check and still hear nobody because their output is
// a disconnected headset. That is a real hole and it is left open on purpose,
// not overlooked.
//
// Pure: no DOM, no media, no timers. The green room supplies what it observes.
import type { ReadinessProblem } from "@/lib/meetings/devices";

/** The two devices this gate covers. The speaker is not one of them — see above. */
export type CheckedDevice = "camera" | "microphone";

/**
 * Whether a person has to pass the check before they can be let in.
 *
 * Guests only, as above. Deliberately a function of one fact rather than a
 * constant, so the decision has one home and the reason can be read next to it
 * rather than inferred from an `isGuest &&` at a call site.
 */
export function deviceCheckRequired(who: { isGuest: boolean }): boolean {
  return who.isGuest;
}

export type CheckStage =
  /** Signal has not arrived yet, and it is too early to call that a fault. */
  | "measuring"
  /** The device cannot be used, or produced nothing once given time. Guidance. */
  | "blocked"
  /** Signal is arriving. Waiting for the person to say it is really them. */
  | "confirming"
  /** They looked, and said no. Guidance, and another go. */
  | "rejected"
  /** Measured and confirmed. */
  | "passed";

/**
 * Where one device stands.
 *
 * `passed` is checked first and nothing below can undo it, because it is a
 * LATCH held by the caller. Without that latch a guest who verified their
 * camera and then stopped talking, or turned the camera off on purpose before
 * joining, would be thrown back to the start — and "turn your camera on to be
 * allowed in, then turn it off again" is not a check, it is a maze. The latch
 * is what lets the gate open once and stay open.
 *
 * A named `problem` outranks a missing signal, because it is the more specific
 * answer to the same observation: a blocked microphone and a microphone that is
 * merely silent both read as no signal, and only one of them has steps that
 * will fix it.
 *
 * `signalSettled` is the grace period, and it only matters while there is no
 * signal. Without it every guest is told their devices are broken for the first
 * few seconds of every join, which teaches them to ignore the one screen this
 * change exists to make them read.
 */
export function checkStage(input: {
  /** Already measured and confirmed earlier in this visit. */
  passed: boolean;
  /** A problem that stops this device working at all, or null. */
  problem: ReadinessProblem | null;
  /** Signal now: a video frame has arrived, or the meter is above silence. */
  signal: boolean;
  /** The grace period for a device that is merely slow has elapsed. */
  signalSettled: boolean;
  /** What the person last answered about this device, or null if not asked yet. */
  answer: boolean | null;
}): CheckStage {
  if (input.passed) return "passed";
  if (input.problem) return "blocked";
  if (!input.signal) return input.signalSettled ? "blocked" : "measuring";
  if (input.answer === false) return "rejected";
  if (input.answer === true) return "passed";
  return "confirming";
}

/** Whether the caller should now latch this device as passed, and stop asking. */
export function shouldLatch(stage: CheckStage, alreadyLatched: boolean): boolean {
  return stage === "passed" && !alreadyLatched;
}

/**
 * Whether the guest may be let in.
 *
 * Both, and nothing else counts. There is no "join anyway": a guest whose
 * microphone genuinely cannot be made to work does not get in, which is the
 * instruction and worth being plain about rather than softening at the last
 * line of code.
 */
export function entryAllowed(stages: Record<CheckedDevice, CheckStage>): boolean {
  return stages.camera === "passed" && stages.microphone === "passed";
}

/**
 * Whether changing a device throws away what was proved about the old one.
 *
 * It does, and it has to. The thing that was verified was a particular piece of
 * hardware; a different camera is a different question, and carrying the answer
 * across is how somebody passes the check on a working webcam and joins on a
 * broken one. Only a real change counts — a re-render that hands back the same
 * id must not reset anything, or the check could never be completed at all.
 */
export function deviceChanged(previousId: string, nextId: string): boolean {
  return previousId !== nextId && nextId !== "";
}

export interface CheckCopy {
  /** The row's heading, which is also what the state is called out loud. */
  label: string;
  /** The question, when there is one to ask. */
  question: string | null;
  /** What to do, when the device produced nothing and no problem named itself. */
  steps: string[];
}

/**
 * What the row says.
 *
 * The microphone's question is about THE METER, not about hearing: nothing here
 * plays sound, so "can you hear yourself?" would be a question this check has
 * no way to make answerable. Asking whether the bars move when they speak is a
 * question the screen actually answers.
 */
export function checkCopy(device: CheckedDevice, stage: CheckStage): CheckCopy {
  if (device === "camera") {
    switch (stage) {
      case "measuring":
        return { label: "Camera", question: null, steps: [] };
      case "confirming":
        return { label: "Camera", question: "Can you see yourself in the preview?", steps: [] };
      case "rejected":
        return {
          label: "Camera",
          question: "Can you see yourself in the preview?",
          steps: [
            "Check nothing is covering the lens, and that the camera is pointed at you.",
            "If your computer has more than one camera, pick another one below.",
          ],
        };
      case "blocked":
        return {
          label: "Camera",
          question: null,
          // Reached when frames never arrived and nothing named a cause: the
          // device opened, so permission and availability are not the problem.
          steps: [
            "Your camera opened but isn't sending a picture.",
            "Pick a different camera below, or close any other app that may be holding it.",
          ],
        };
      case "passed":
        return { label: "Camera", question: null, steps: [] };
    }
  }

  switch (stage) {
    case "measuring":
      return { label: "Microphone", question: null, steps: [] };
    case "confirming":
      return { label: "Microphone", question: "Say something — do the bars move?", steps: [] };
    case "rejected":
      return {
        label: "Microphone",
        question: "Say something — do the bars move?",
        steps: [
          "Make sure you are speaking into the microphone you picked, and that it is not muted on the device itself.",
          "If you have another microphone — a headset, or your laptop's own — pick it below.",
        ],
      };
    case "blocked":
      return {
        label: "Microphone",
        question: null,
        steps: [
          "Your microphone isn't picking anything up.",
          "Pick a different microphone below, or close any other app that may be using it.",
        ],
      };
    case "passed":
      return { label: "Microphone", question: null, steps: [] };
  }
}

/**
 * Whether the camera being switched off is what is holding the gate shut.
 *
 * Joining with the camera deliberately off is a state this product supports and
 * people want — the toggle exists so the hardware light stays dark. But a camera
 * that is off produces nothing, so it cannot be verified, and the generic "your
 * camera isn't sending a picture" would be a lie told to somebody who switched
 * it off on purpose.
 *
 * So this case gets its own sentence, and the resolution is the honest one: turn
 * it on long enough to be checked, then turn it off again. The latch in
 * `checkStage` is what makes that second half true.
 */
export function cameraOffBlocksEntry(state: { enabled: boolean; passed: boolean }): boolean {
  return !state.enabled && !state.passed;
}

/** What to say in that case. */
export const CAMERA_OFF_STEPS: readonly string[] = [
  "Turn your camera on so it can be checked.",
  "You can turn it straight back off before you join — once it has been checked it stays checked.",
];

/**
 * The sentence under a blocked Join button.
 *
 * Says which device is in the way rather than that something is, because "check
 * your devices" in front of somebody whose camera is fine and whose microphone
 * is not costs them the next two minutes.
 */
export function blockedReason(stages: Record<CheckedDevice, CheckStage>): string | null {
  const unfinished = (["microphone", "camera"] as const).filter((d) => stages[d] !== "passed");
  if (unfinished.length === 0) return null;
  const names = unfinished.map((d) => (d === "microphone" ? "microphone" : "camera"));
  const who = names.length === 1 ? `your ${names[0]}` : "your microphone and camera";
  return `Check ${who} above before joining.`;
}

/**
 * How long a device gets to produce something before silence is called a fault.
 *
 * The microphone's own settling period is `MIC_SETTLE_MS` in the green room and
 * is about a person not having spoken yet. This is the same idea for the camera,
 * which has no equivalent: a freshly opened camera reports no frame for a moment
 * and judging it immediately would condemn one that is merely starting.
 */
export const CAMERA_SETTLE_MS = 3_000;
