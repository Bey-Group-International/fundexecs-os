// lib/gates.ts
// The Gate Layer — the only control primitive for autonomous action.
//
// FundExecs OS models how a Managing Partner delegates to a COO: Earn and the
// executive bench can do a great deal on their own, but every action is
// classified into one of three tiers that decide whether it needs the
// operator's sign-off before it happens.
//
//   Tier 1 — Internal / Draft       → never gated        (COO discretion)
//   Tier 2 — External-facing        → operator sign-off  (unless pre-authorized)
//   Tier 3 — Compliance / Capital   → always the operator (never delegable)
//
// A Mandate is the operator's standing job-description for Earn: it can
// pre-authorize specific Tier-2 actions to run unattended, up to an autonomy
// ceiling. Tier 3 can NEVER be overridden — it is the structural line a COO
// cannot cross. This module is pure (no DB, no I/O) so the same classification
// holds everywhere: the Capital Map, the task engine, and the API layer.

export type GateTier = 1 | 2 | 3;

// Every discrete thing an agent might want to do. Grouped by tier; the grouping
// is the single source of truth for `tierForAction`.
export type ActionKind =
  // Tier 1 — internal work product, never leaves the building.
  | "draft_message"
  | "draft_memo"
  | "update_pipeline"
  | "score"
  | "research"
  | "build_list"
  // Inbox: drafting a reply / spinning up a video room are internal prep —
  // nothing reaches the counterparty until it is sent (a Tier-2 action).
  | "draft_reply"
  | "create_video_meeting"
  // Tier 2 — external-facing; touches a counterparty.
  | "send_outreach"
  | "send_intro_request"
  | "share_materials"
  | "send_diligence_request"
  | "distribute_report"
  // Inbox: replying, proposing a time, or confirming a booking all reach the
  // counterparty, so they are gated like any other outward move.
  | "send_reply"
  | "propose_meeting"
  | "confirm_booking"
  // Tier 3 — compliance- or capital-binding; creates an obligation.
  | "sign_document"
  | "submit_term_sheet"
  | "move_capital"
  | "capital_call"
  | "execute_subdoc";

const TIER_1: ActionKind[] = [
  "draft_message",
  "draft_memo",
  "update_pipeline",
  "score",
  "research",
  "build_list",
  "draft_reply",
  "create_video_meeting",
];

const TIER_2: ActionKind[] = [
  "send_outreach",
  "send_intro_request",
  "share_materials",
  "send_diligence_request",
  "distribute_report",
  "send_reply",
  "propose_meeting",
  "confirm_booking",
];

const TIER_3: ActionKind[] = [
  "sign_document",
  "submit_term_sheet",
  "move_capital",
  "capital_call",
  "execute_subdoc",
];

export function tierForAction(action: ActionKind): GateTier {
  if (TIER_1.includes(action)) return 1;
  if (TIER_2.includes(action)) return 2;
  return 3;
}

export const TIER_LABEL: Record<GateTier, string> = {
  1: "Internal",
  2: "External",
  3: "Capital-binding",
};

export const TIER_DESCRIPTION: Record<GateTier, string> = {
  1: "Drafts and internal work product. Earn proceeds on its own.",
  2: "Reaches a counterparty. Needs your sign-off unless pre-authorized by a mandate.",
  3: "Creates a binding or capital obligation. Always requires you — never delegable.",
};

// A Mandate is the operator's standing delegation to Earn. It can lift specific
// Tier-2 actions to auto-execution within an autonomy ceiling. A ceiling of 3 is
// intentionally impossible to honor: Tier 3 is never delegable.
export interface Mandate {
  // Tier-2 action kinds the operator has standing-approved.
  autoApprove: ActionKind[];
  // The highest tier this mandate may auto-execute. Clamped to 2 in practice.
  autonomyCeiling: GateTier;
}

export interface GateDecision {
  tier: GateTier;
  // True when the operator must approve before the action can happen.
  requiresApproval: boolean;
  // Human-readable rationale, shown next to the action in the UI.
  reason: string;
}

/**
 * Decide whether an action may proceed autonomously or must be gated for the
 * operator. The mandate can only ever relax Tier 2; Tier 1 is always free and
 * Tier 3 is always gated, regardless of what any mandate claims.
 */
export function gateDecision(action: ActionKind, mandate?: Mandate): GateDecision {
  const tier = tierForAction(action);

  if (tier === 1) {
    return { tier, requiresApproval: false, reason: TIER_DESCRIPTION[1] };
  }

  if (tier === 3) {
    return {
      tier,
      requiresApproval: true,
      reason: "Capital- or compliance-binding — this always requires you.",
    };
  }

  // Tier 2: gated unless a mandate pre-authorizes this exact action within a
  // ceiling that actually reaches Tier 2.
  const preAuthorized =
    !!mandate && mandate.autonomyCeiling >= 2 && mandate.autoApprove.includes(action);

  return preAuthorized
    ? { tier, requiresApproval: false, reason: "Pre-authorized by your active mandate." }
    : { tier, requiresApproval: true, reason: TIER_DESCRIPTION[2] };
}
