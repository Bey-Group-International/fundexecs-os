// lib/autonomy.ts
// Dynamic autonomy resolution — translates the gate tier of a workflow step
// into the AutonomyMode passed to the Brain layer.
//
// The three-tier gate model maps cleanly onto three autonomy levels:
//
//   Tier 1 (internal / draft)  → "auto"   — Brain runs end-to-end; no
//                                            human gate in the loop.
//   Tier 2 (external-facing)   → "auto" when the org mandate pre-authorizes
//                                the action kind; otherwise "semi" (the Brain
//                                surfaces key decisions for the operator to
//                                approve via the existing approval gate).
//   Tier 3 (compliance/capital)→ "manual" — Brain presents its reasoning but
//                                every output waits for explicit operator sign-off.
//
// This module is pure (no DB, no I/O) so it can be called inline without
// async overhead. The mandate is fetched once per workflow and threaded in.

import type { AutonomyMode } from "@/lib/brains/types";
import type { ActionKind, Mandate } from "@/lib/gates";
import { tierForAction, gateDecision } from "@/lib/gates";

/**
 * Resolve the AutonomyMode a Brain should run at for a given action kind,
 * taking the org's active mandate into account.
 *
 * - Tier 1 → always "auto"
 * - Tier 2 → "auto" if mandate pre-authorizes; "semi" otherwise
 * - Tier 3 → always "manual"
 *
 * Safe to call with no mandate: falls back to "semi" for Tier 2.
 */
export function resolveAutonomy(action: ActionKind, mandate?: Mandate): AutonomyMode {
  const tier = tierForAction(action);
  if (tier === 1) return "auto";
  if (tier === 3) return "manual";
  // Tier 2: consult the gate. If it wouldn't require approval (mandate
  // pre-authorized + verifiability check passes), run auto; else semi.
  const decision = gateDecision(action, mandate);
  return decision.requiresApproval ? "semi" : "auto";
}

// Maps an agent's step intent classification to a representative ActionKind
// so the autonomy resolver can be called without a full gate-layer ActionKind.
// The intent→action mapping is conservative: ambiguous intents default to
// lower tiers rather than higher ones.
const INTENT_TO_ACTION: Record<string, ActionKind> = {
  text_generation: "draft_memo",
  draft_document: "draft_memo",
  query_data: "research",
  send_email: "send_outreach",
  book_meeting: "propose_meeting",
};

export function resolveAutonomyForIntent(
  intent: string,
  mandate?: Mandate,
): AutonomyMode {
  const action = (INTENT_TO_ACTION[intent] ?? "draft_memo") as ActionKind;
  return resolveAutonomy(action, mandate);
}
