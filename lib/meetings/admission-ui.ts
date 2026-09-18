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
  /**
   * The server is turning knocks away, so nobody has been told about this
   * guest yet. Still trying — but it is not a queue, and must not be described
   * as one.
   */
  | "busy"
  /** Long enough that the host may not be coming. Still waiting. */
  | "timed-out"
  /** The wait ran out its bound. Nothing is asking any more. */
  | "gave-up"
  /** Let in, and entering the room did not work. Nothing is waiting any more. */
  | "failed";

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

/** Whether this state is a failure rather than a stage of waiting. */
export function isAdmissionFailure(state: AdmissionUiState): boolean {
  return state === "failed";
}

/** Whether anything is still asking on the guest's behalf. */
export function isAdmissionLive(state: AdmissionUiState): boolean {
  return state === "asking" || state === "waiting" || state === "busy" || state === "timed-out";
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
    case "busy":
      // Deliberately not "waiting for the host": a refused knock inserted no
      // row, so the host has not been told about this guest at all. Saying they
      // are in a queue they are not in is the defect this state exists to end.
      return {
        title: "Too many people are joining at once",
        detail: "We haven't been able to reach the host yet. Still trying.",
        cancelLabel: "Cancel",
      };
    case "timed-out":
      return {
        title: "The host hasn't answered yet",
        detail: "You'll be let in as soon as they do.",
        cancelLabel: "Stop waiting",
      };
    case "gave-up":
      // The wait ended itself. Nothing is polling now, so this has to offer the
      // way back rather than describe something in progress — and it must not
      // read as a refusal, because nobody refused anything.
      return {
        title: "We stopped waiting",
        detail: "The host didn't answer. You can ask again whenever you like.",
        cancelLabel: "Ask again",
      };
    case "failed":
      // The one state here that is not a wait. The host said yes and the room
      // could not be entered — devices, the network, the connection. Nothing is
      // polling any more, so this must offer the way back itself rather than
      // describing something still in progress.
      return {
        title: "Couldn't join the meeting",
        detail: "The host let you in, but something went wrong on the way. Your camera and microphone are still set up.",
        cancelLabel: "Try again",
      };
  }
}
