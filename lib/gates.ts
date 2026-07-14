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
  // Finance ledger (internal bookkeeping): posting to an OPEN period and
  // reversing an entry are routine internal work product.
  | "post_journal_entry"
  | "reverse_journal_entry"
  // Finance banking (internal bookkeeping): importing a statement file and
  // reconciling a staged transaction are routine internal work product.
  | "import_bank_file"
  | "reconcile_transaction"
  // Finance AR/AP (internal bookkeeping): recording an invoice/bill and applying
  // a payment are routine internal work product (sending an invoice OUT to a
  // counterparty would be a separate Tier-2 action).
  | "issue_invoice"
  | "record_payment"
  // Tier 3 — compliance- or capital-binding; creates an obligation.
  | "sign_document"
  | "submit_term_sheet"
  | "move_capital"
  | "capital_call"
  | "execute_subdoc"
  // Finance controls: force-posting into a closed period, or closing/reopening a
  // period, lock or unlock the books — never delegable.
  | "post_to_closed_period"
  | "close_period"
  | "reopen_period";

const TIER_1: ActionKind[] = [
  "draft_message",
  "draft_memo",
  "update_pipeline",
  "score",
  "research",
  "build_list",
  "draft_reply",
  "create_video_meeting",
  "post_journal_entry",
  "reverse_journal_entry",
  "import_bank_file",
  "reconcile_transaction",
  "issue_invoice",
  "record_payment",
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
  "post_to_closed_period",
  "close_period",
  "reopen_period",
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

// Blast-radius rules are the hard ceilings on Earn's automated footprint. Unlike
// `autoApprove` (which RELAXES the gate), blast-radius rules only ever TIGHTEN it:
// a pre-authorized Tier-2 send still falls back to the human gate when it would
// breach one of these limits. All fields are optional — an absent limit is not a
// constraint.
export interface BlastRadius {
  // Max number of automated Tier-2 sends allowed per day. Once reached, further
  // pre-authorized sends fall back to sign-off.
  maxOutreachPerDay?: number;
  // Dollar ceiling for a single automated action. An action carrying a larger
  // figure loses its auto-approve bypass.
  maxDollarPerAction?: number;
  // Counterparty domains Earn may never auto-contact (a do-not-contact list).
  // Matched case-insensitively against the target's domain and its subdomains.
  forbiddenDomains?: string[];
}

// A Mandate is the operator's standing delegation to Earn. It can lift specific
// Tier-2 actions to auto-execution within an autonomy ceiling. A ceiling of 3 is
// intentionally impossible to honor: Tier 3 is never delegable.
export interface Mandate {
  // Tier-2 action kinds the operator has standing-approved.
  autoApprove: ActionKind[];
  // The highest tier this mandate may auto-execute. Clamped to 2 in practice.
  autonomyCeiling: GateTier;
  // Free-text constraints Earn must respect during execution (e.g. "Never contact
  // a counterparty before I review the draft"). These are advisory to the gate —
  // they are injected into Earn's context, not machine-enforced — so they are not
  // consulted by `gateDecision`. Optional; absent on legacy callers.
  guardrails?: string[];
  // Hard limits on the automated footprint, enforced by `gateDecision` when the
  // action's `GateContext` supplies the relevant figure. Optional.
  blastRadius?: BlastRadius;
}

// The concrete particulars of the action being gated, used to enforce
// blast-radius rules. Everything is optional: a check only fires when both the
// rule and its corresponding context value are present, so omitting context
// simply skips blast-radius enforcement (identical to the pre-blast-radius gate).
export interface GateContext {
  // The counterparty domain (or email) this action would reach. Used against
  // `blastRadius.forbiddenDomains`.
  targetDomain?: string;
  // The capital/dollar figure this action carries. Used against
  // `blastRadius.maxDollarPerAction`.
  dollarAmount?: number;
  // The count of automated Tier-2 sends already made today. Used against
  // `blastRadius.maxOutreachPerDay`.
  sendsToday?: number;
}

// Reduce a raw domain or email to a bare, comparable hostname: lowercase, no
// protocol, no `www.`, no path, and the local part of an email dropped.
function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  const at = d.lastIndexOf("@");
  if (at !== -1) d = d.slice(at + 1);
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const slash = d.indexOf("/");
  if (slash !== -1) d = d.slice(0, slash);
  return d;
}

// True when `target` is `forbidden` or a subdomain of it (a.example.com matches
// example.com). Both are normalized first.
function domainForbidden(target: string, forbidden: string): boolean {
  const t = normalizeDomain(target);
  const f = normalizeDomain(forbidden);
  if (!t || !f) return false;
  return t === f || t.endsWith(`.${f}`);
}

/**
 * The blast-radius breach (if any) that revokes a pre-authorized action's
 * auto-approve bypass, as an operator-facing reason. Returns null when no rule is
 * breached — including when the mandate carries no blast-radius rules or the
 * context supplies no figure to check. Pure and side-effect free.
 */
export function blastRadiusBreach(
  blastRadius?: BlastRadius,
  context?: GateContext,
): string | null {
  if (!blastRadius || !context) return null;

  if (context.targetDomain && blastRadius.forbiddenDomains?.length) {
    const hit = blastRadius.forbiddenDomains.find((d) =>
      domainForbidden(context.targetDomain as string, d),
    );
    if (hit) {
      return `Blast-radius rule: ${normalizeDomain(context.targetDomain)} is on your do-not-contact list — sign-off required.`;
    }
  }

  if (
    blastRadius.maxDollarPerAction != null &&
    context.dollarAmount != null &&
    context.dollarAmount > blastRadius.maxDollarPerAction
  ) {
    return `Blast-radius rule: $${context.dollarAmount.toLocaleString("en-US")} exceeds your $${blastRadius.maxDollarPerAction.toLocaleString("en-US")} per-action ceiling — sign-off required.`;
  }

  if (
    blastRadius.maxOutreachPerDay != null &&
    context.sendsToday != null &&
    context.sendsToday >= blastRadius.maxOutreachPerDay
  ) {
    return `Blast-radius rule: daily automated-send cap of ${blastRadius.maxOutreachPerDay} reached — sign-off required.`;
  }

  return null;
}

export interface GateDecision {
  tier: GateTier;
  // True when the operator must approve before the action can happen.
  requiresApproval: boolean;
  // Human-readable rationale, shown next to the action in the UI.
  reason: string;
}

// The verification standing of the work product an action would send outward.
// `verifiable` is true when an operator has signed the artifact off or it is
// automatically well-grounded (see lib/grounding.ts `isVerifiable`). Supplied
// only for actions that carry a composer artifact; omit it otherwise.
export interface Backing {
  verifiable: boolean;
}

/**
 * Decide whether an action may proceed autonomously or must be gated for the
 * operator. The mandate can only ever relax Tier 2; Tier 1 is always free and
 * Tier 3 is always gated, regardless of what any mandate claims.
 *
 * Trust layer: a mandate may only auto-execute a Tier-2 action when the work
 * product behind it is verifiable. Unverified, weakly-grounded output cannot
 * ride the auto-approve bypass to a counterparty — it falls back to the human
 * gate. Internal (Tier 1) work is unaffected; Tier 3 is always gated anyway.
 *
 * Blast-radius layer: even a verified, pre-authorized Tier-2 action falls back to
 * the human gate when it would breach one of the mandate's hard footprint limits
 * (forbidden domain, per-action dollar ceiling, daily send cap). Blast-radius
 * rules only ever tighten — they never relax the gate — and are checked only when
 * `context` supplies the relevant figure, so omitting `context` preserves the
 * exact pre-blast-radius behavior.
 */
export function gateDecision(
  action: ActionKind,
  mandate?: Mandate,
  backing?: Backing,
  context?: GateContext,
): GateDecision {
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

  if (preAuthorized && backing && !backing.verifiable) {
    return {
      tier,
      requiresApproval: true,
      reason: "Unverified, weakly-grounded output — sign-off required before it reaches a counterparty.",
    };
  }

  if (preAuthorized) {
    const breach = blastRadiusBreach(mandate?.blastRadius, context);
    if (breach) {
      return { tier, requiresApproval: true, reason: breach };
    }
  }

  return preAuthorized
    ? { tier, requiresApproval: false, reason: "Pre-authorized by your active mandate." }
    : { tier, requiresApproval: true, reason: TIER_DESCRIPTION[2] };
}

// Tier → badge Tailwind classes. Green = free, gold = sign-off, red = never delegable.
// Shared across CapitalMap, Inbox, and any other surface that renders tier badges.
export const TIER_STYLE: Record<GateTier, string> = {
  1: "border-status-success/40 text-status-success",
  2: "border-gold-500/50 text-gold-400",
  3: "border-status-danger/50 text-status-danger",
};
