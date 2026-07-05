// lib/proactive/gate.ts
// The Gate stage — reuse the EXISTING approval-gate model (lib/gates.ts), never
// a parallel one. Proactive does not loosen gates; it TIGHTENS them, because
// Earn — not the operator — initiated the work. Two rules layer on top of the
// base tier classifier:
//
//   1. Draft-only work (Tier 1) pre-runs silently so the item arrives finished.
//      The SURFACED decision is the outward send, sized by its own ActionKind.
//   2. Any draft carrying externally-sourced intelligence (a PMI/market claim)
//      is investor-facing AT MINIMUM — external data never auto-sends. So we
//      floor the send tier at 2 whenever the candidate has provenance claims.
//
// Tier 3 (compliance/capital-binding) stays always-gated and non-skippable,
// exactly as the base model enforces — a mandate can never lift it.

import {
  tierForAction,
  gateDecision,
  type ActionKind,
  type GateTier,
  type Mandate,
  type Backing,
} from "@/lib/gates";
import type { ProactiveCandidate } from "./types";

export interface ProactiveGate {
  /** The blast-radius tier the surfaced send action carries. */
  sendTier: GateTier;
  /** Whether the drafting work may pre-run unattended (always true — Tier 1). */
  draftAutoRuns: boolean;
  /** Whether the outward send needs operator sign-off before it leaves. */
  requiresApproval: boolean;
  /** True when the send is compliance/capital-binding — non-skippable sign-off. */
  nonSkippable: boolean;
  reason: string;
  /** Whether a PMI/market claim forced the tier up to investor-facing. */
  externallyGrounded: boolean;
}

/**
 * Resolve the gate for a proactive candidate. The drafting is Tier 1 and always
 * pre-runs; the surfaced send is classified by its ActionKind, floored to Tier 2
 * when the draft embeds external intelligence, and evaluated against the org
 * mandate (which can only ever relax Tier 2 — never Tier 3).
 *
 * `backing.verifiable` is passed through so an unverified, weakly-grounded draft
 * cannot ride a mandate's auto-approve to a counterparty — it falls back to the
 * human gate (the existing trust-layer behavior in gateDecision).
 */
export function resolveProactiveGate(
  candidate: ProactiveCandidate,
  opts: { mandate?: Mandate; backingVerifiable?: boolean } = {},
): ProactiveGate {
  const externallyGrounded = candidate.claims.length > 0;
  let sendAction: ActionKind = candidate.sendAction;

  // Floor at investor-facing when externally grounded: if the declared send is
  // Tier 1 but the draft cites external intel, promote it to a Tier-2 send so it
  // cannot slip out as "internal".
  const baseTier = tierForAction(sendAction);
  if (externallyGrounded && baseTier === 1) {
    sendAction = "share_materials"; // a Tier-2 external-facing send
  }

  const backing: Backing | undefined =
    opts.backingVerifiable === undefined ? undefined : { verifiable: opts.backingVerifiable };
  const decision = gateDecision(sendAction, opts.mandate, backing);

  return {
    sendTier: decision.tier,
    draftAutoRuns: true,
    requiresApproval: decision.requiresApproval,
    nonSkippable: decision.tier === 3,
    reason: externallyGrounded && baseTier === 1
      ? `Externally grounded — floored to investor-facing. ${decision.reason}`
      : decision.reason,
    externallyGrounded,
  };
}
