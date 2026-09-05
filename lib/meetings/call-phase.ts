// lib/meetings/call-phase.ts
// The lifecycle of leaving a meeting.
//
// Leaving used to be treated as instantaneous — one click, teardown, navigate.
// Ending is not: it posts the transcript to a model that can take up to two
// minutes, and the call is already torn down before that request goes out. With
// no phase to show for it the screen sat on frozen video behind a button that
// still looked live, which reads as a hung app; and because the button stayed
// live, a second click really did start a second report.
//
// The phases and the moves between them live here so those rules can be stated
// once and tested, rather than being implied by the order of statements in a
// click handler.

export type CallPhase =
  /** In the meeting. Everything running. */
  | "live"
  /** Torn down; the report is generating. Exit controls are inert. */
  | "ending"
  /** The report request failed. The user can retry or leave without it. */
  | "failed"
  /** Out of the call, with nothing left to wait for. */
  | "left";

export type CallEvent =
  /** This participant pressed Leave. */
  | "leave"
  /** The host pressed End for all. */
  | "end"
  /** The report came back. */
  | "report_ok"
  /** The report request failed or returned an error status. */
  | "report_failed"
  /** The user chose to stop waiting for the report. */
  | "abandon"
  /** The host ended the meeting, or this participant was removed. */
  | "remote_end";

/**
 * Whether an exit press should do anything.
 *
 * False during "ending" is the whole point: that press would tear down an
 * already dead call and post a second report — a second stored report row, and
 * a second batch of auto-created tasks for one meeting.
 */
export function canExit(phase: CallPhase): boolean {
  return phase === "live" || phase === "failed";
}

/** Whether the periodic work of a live call (metering, notes, stats) should run. */
export function isCallRunning(phase: CallPhase): boolean {
  return phase === "live";
}

/** Whether to show the "ending…" progress overlay. */
export function isAwaitingReport(phase: CallPhase): boolean {
  return phase === "ending";
}

/** What the exit button reads, so a press visibly changes something. */
export function exitLabel(phase: CallPhase, isHost: boolean): string {
  if (phase === "ending") return isHost ? "Ending…" : "Leaving…";
  return isHost ? "End for all" : "Leave";
}

export function nextPhase(phase: CallPhase, event: CallEvent): CallPhase {
  // Being removed, or the host ending the room, wins from any phase: there is no
  // call left to wait on.
  if (event === "remote_end") return "left";

  // Everything else is ignored unless the phase can act on it. Without this an
  // exit press during "ending" would restart the whole flow.
  if (event === "leave") return canExit(phase) ? "left" : phase;
  if (event === "end") return canExit(phase) ? "ending" : phase;
  if (event === "abandon") return "left";
  if (event === "report_ok") return phase === "ending" ? "left" : phase;
  if (event === "report_failed") return phase === "ending" ? "failed" : phase;
  return phase;
}
