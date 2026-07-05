// lib/earn/browser-operator/session-machine.ts
//
// The pure state machine that governs a browser-operator session. This is the
// safety spine: the API layer routes EVERY status change through here and
// rejects anything illegal with a 409. It is deliberately dependency-free and
// exhaustively unit-testable.
//
// Invariants it enforces:
//   • You cannot reach `saved` without first passing `awaiting_user_review`
//     (extracting → saved is impossible).
//   • `paused_for_user_auth` only advances to `user_auth_completed`, and only
//     on an explicit resume event — Earn cannot self-resume an auth handoff.
//   • Any non-terminal state may be `cancelled` or `failed` at any time
//     (the operator can always stop the operator).
//   • Terminal states never transition again.

import type { EarnBrowserSessionStatus } from "./types";
import { isTerminalStatus } from "./types";

/**
 * The legal "forward" adjacency, excluding the universal cancel/fail edges
 * (handled separately so we never have to list them on every state).
 */
const FORWARD_TRANSITIONS: Record<EarnBrowserSessionStatus, EarnBrowserSessionStatus[]> = {
  planned: ["awaiting_user_approval"],
  awaiting_user_approval: ["opening_browser"],
  opening_browser: ["navigating"],
  // A site may or may not require a login; both branches are legal.
  navigating: ["paused_for_user_auth", "extracting"],
  // Auth handoff can ONLY complete — nothing else advances from a pause.
  paused_for_user_auth: ["user_auth_completed"],
  // After the operator signs in, Earn resumes navigating or goes straight to
  // extraction.
  user_auth_completed: ["navigating", "extracting"],
  extracting: ["normalizing"],
  normalizing: ["awaiting_user_review"],
  // The review gate: the operator approves the save or rejects the batch.
  awaiting_user_review: ["approved_for_save", "rejected"],
  approved_for_save: ["saved"],
  // Terminal states.
  saved: [],
  rejected: [],
  cancelled: [],
  failed: [],
};

/**
 * True when `from → to` is a legal transition. Cancel and fail are legal from
 * any non-terminal state; everything else must follow `FORWARD_TRANSITIONS`.
 */
export function canTransition(
  from: EarnBrowserSessionStatus,
  to: EarnBrowserSessionStatus,
): boolean {
  if (from === to) return false;
  // Nothing leaves a terminal state — not even to cancelled/failed.
  if (isTerminalStatus(from)) return false;
  // The operator (or a fault) can always stop a live session.
  if (to === "cancelled" || to === "failed") return true;
  return FORWARD_TRANSITIONS[from].includes(to);
}

/**
 * The events that drive the machine. These are the vocabulary the API layer
 * speaks; `nextOnEvent` resolves each into a target status and validates it.
 */
export type SessionEvent =
  | "submit_scope"
  | "approve_scope"
  | "browser_opened"
  | "auth_required"
  | "resume_after_auth"
  | "auth_continue"
  | "begin_extraction"
  | "extraction_complete"
  | "normalization_complete"
  | "approve_save"
  | "reject"
  | "save_complete"
  | "cancel"
  | "fail";

/** The status an event would move the session to, before legality is checked. */
function targetForEvent(event: SessionEvent): EarnBrowserSessionStatus {
  switch (event) {
    case "submit_scope":
      return "awaiting_user_approval";
    case "approve_scope":
      return "opening_browser";
    case "browser_opened":
      return "navigating";
    case "auth_required":
      return "paused_for_user_auth";
    case "resume_after_auth":
      return "user_auth_completed";
    case "auth_continue":
      return "navigating";
    case "begin_extraction":
      return "extracting";
    case "extraction_complete":
      return "normalizing";
    case "normalization_complete":
      return "awaiting_user_review";
    case "approve_save":
      return "approved_for_save";
    case "reject":
      return "rejected";
    case "save_complete":
      return "saved";
    case "cancel":
      return "cancelled";
    case "fail":
      return "failed";
  }
}

/**
 * Resolve an event against the current status. Returns the next status when the
 * transition is legal, or `null` when the event cannot fire from `status`.
 *
 * Because `canTransition` owns the legality (e.g. only `paused_for_user_auth`
 * has `user_auth_completed` as a forward edge), `resume_after_auth` fired from
 * any other state resolves to `null` automatically.
 */
export function nextOnEvent(
  status: EarnBrowserSessionStatus,
  event: SessionEvent,
): EarnBrowserSessionStatus | null {
  const target = targetForEvent(event);
  return canTransition(status, target) ? target : null;
}

/** Every status reachable from `from` in one legal step (including cancel/fail). */
export function legalNextStatuses(
  from: EarnBrowserSessionStatus,
): EarnBrowserSessionStatus[] {
  if (isTerminalStatus(from)) return [];
  const forward = FORWARD_TRANSITIONS[from];
  const out: EarnBrowserSessionStatus[] = [...forward];
  for (const t of ["cancelled", "failed"] as const) {
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
