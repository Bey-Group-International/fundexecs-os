// lib/meetings/admission-ui.ts
// What the pre-join screen says while a guest is being let in.
//
// The screen a guest knocks from and the screen they wait on are the same
// screen. That is the whole design, and it is worth saying why, because the
// first version did the obvious thing instead and it was worse in five ways.
//
// Pressing Join used to replace the green room with a dedicated waiting screen.
// That screen re-rendered the camera into a second <video> — a visible flicker
// on the one frame the guest is actually looking at, their own face — and threw
// away the mic and camera toggles, the device pickers, the background picker and
// the level meter. Those are the controls somebody wants during a wait, because
// a wait is the only idle time in a meeting: it is when you notice your camera
// is pointed at the ceiling, or that you are on the wrong microphone, or that
// you would rather blur the room behind you. Then admission swapped the screen a
// third time. Three screens for one join, each one a moment where the picture
// jumps and the controls move.
//
// Keeping one screen removes all of that. The button becomes a status; nothing
// else moves. When the host says yes, the guest enters with exactly the camera,
// microphone and background they have been looking at.

/** Where a joiner is in the business of being let in. */
export type AdmissionUiState =
  /** Not knocking. The Join button is live. */
  | "idle"
  /** The knock is in flight — a round trip, usually too fast to read. */
  | "asking"
  /** Knocked, and the host has not answered. */
  | "waiting"
  /** Long enough that the host may not be coming. Still waiting. */
  | "timed-out";

export interface AdmissionStatusCopy {
  title: string;
  detail: string;
  /** Null while there is nothing yet to cancel. */
  cancelLabel: string | null;
}

/** Whether the join control should still accept a press. */
export function canPressJoin(state: AdmissionUiState): boolean {
  return state === "idle";
}

/** Whether the guest is knocking or waiting, rather than merely looking. */
export function isAwaitingAdmission(state: AdmissionUiState): boolean {
  return state !== "idle";
}

/**
 * What to show in place of the join button.
 *
 * The timed-out copy is careful: the wait is still live — the session keeps
 * asking, and a host who answers at three minutes still gets their guest in — so
 * it reports what has happened without claiming the chance has gone.
 *
 * Both cancels return the guest to the same screen with the button back, rather
 * than sending them anywhere. Giving up on a wait is not leaving the meeting:
 * their camera, microphone and background are all still set up, and asking again
 * should cost one press.
 */
export function admissionStatusCopy(state: AdmissionUiState): AdmissionStatusCopy | null {
  switch (state) {
    case "idle":
      return null;
    case "asking":
      return { title: "Asking to join…", detail: "One moment.", cancelLabel: null };
    case "waiting":
      return {
        title: "Waiting for the host to let you in",
        detail: "You can keep setting up while you wait.",
        cancelLabel: "Cancel",
      };
    case "timed-out":
      return {
        title: "The host hasn't answered yet",
        detail: "You'll be let in as soon as they do.",
        cancelLabel: "Stop waiting",
      };
  }
}
