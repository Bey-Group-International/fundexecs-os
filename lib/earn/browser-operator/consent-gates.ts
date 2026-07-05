// lib/earn/browser-operator/consent-gates.ts
//
// Bridges browser-operator intents into the platform Gate Layer (lib/gates.ts),
// so the same three-tier control model that governs the Capital Map and the
// task engine also governs what Earn does in a browser:
//
//   Tier 1 — internal research / extraction   → COO discretion, never gated
//   Tier 2 — preparing external outreach       → operator sign-off
//   Tier 3 — capital-binding / data-room access→ always the operator
//
// We map each browser intent to the closest platform `ActionKind` and reuse
// `tierForAction` — the tier logic lives in exactly one place.

import type { ActionKind, GateTier } from "@/lib/gates";
import { tierForAction, TIER_LABEL } from "@/lib/gates";

/**
 * The intent behind a browser operation. This is coarser than a raw click — it
 * is what the operation is *for*, which is what a consent gate cares about.
 */
export type BrowserOperationIntent =
  | "navigate"
  | "read_page"
  | "extract_data"
  | "build_prospect_list"
  | "draft_outreach"
  | "prepare_outreach"
  | "send_message"
  | "submit_form"
  | "request_intro"
  | "grant_data_room_access"
  | "make_purchase"
  | "bind_capital"
  | "sign_document";

/**
 * Map a browser intent to a platform `ActionKind`. The mapping preserves tier:
 * read/extract → Tier 1 research, outreach → Tier 2, capital/data-room → Tier 3.
 */
const INTENT_TO_ACTION: Record<BrowserOperationIntent, ActionKind> = {
  // Tier 1 — internal research & work product.
  navigate: "research",
  read_page: "research",
  extract_data: "research",
  build_prospect_list: "build_list",
  draft_outreach: "draft_message",
  // Tier 2 — reaches / prepares to reach a counterparty.
  prepare_outreach: "send_outreach",
  send_message: "send_outreach",
  submit_form: "send_outreach",
  request_intro: "send_intro_request",
  // Tier 3 — capital- or compliance-binding. Granting data-room access exposes
  // confidential materials, so it rides the never-delegable Tier-3 rail
  // alongside capital movement and signatures.
  grant_data_room_access: "move_capital",
  make_purchase: "move_capital",
  bind_capital: "move_capital",
  sign_document: "sign_document",
};

/** The Gate tier for a browser intent, via the shared platform classifier. */
export function browserActionTier(intent: BrowserOperationIntent): GateTier {
  return tierForAction(INTENT_TO_ACTION[intent]);
}

/** Human label ("Internal" / "External" / "Capital-binding") for the intent. */
export function browserActionTierLabel(intent: BrowserOperationIntent): string {
  return TIER_LABEL[browserActionTier(intent)];
}

/**
 * Intents that actually act on the outside world (mutations that leave the
 * sandbox), as opposed to internal reading/drafting. These need their own
 * separate external-action approval on top of scope approval.
 */
const EXTERNAL_ACTION_INTENTS: ReadonlySet<BrowserOperationIntent> = new Set([
  "send_message",
  "submit_form",
  "request_intro",
  "grant_data_room_access",
  "make_purchase",
  "bind_capital",
  "sign_document",
]);

/**
 * Whether an intent needs a SEPARATE external-action approval before it can
 * fire. Reading, extracting, and drafting never do; anything that sends,
 * submits, purchases, or binds always does — regardless of scope approval.
 */
export function needsExternalActionApproval(intent: BrowserOperationIntent): boolean {
  return EXTERNAL_ACTION_INTENTS.has(intent);
}

export interface BrowserConsentDecision {
  intent: BrowserOperationIntent;
  tier: GateTier;
  tierLabel: string;
  requiresExternalActionApproval: boolean;
  /** True when the tier alone forces the operator to sign off (Tier ≥ 2). */
  requiresOperatorSignoff: boolean;
}

/** Full consent read on a single browser intent — used by the API + UI. */
export function evaluateBrowserConsent(
  intent: BrowserOperationIntent,
): BrowserConsentDecision {
  const tier = browserActionTier(intent);
  return {
    intent,
    tier,
    tierLabel: TIER_LABEL[tier],
    requiresExternalActionApproval: needsExternalActionApproval(intent),
    requiresOperatorSignoff: tier >= 2,
  };
}
