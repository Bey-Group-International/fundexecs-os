// lib/terminal/action-contract.ts
// The unified action & safety contract for the terminal (System 9).
//
// The terminal does NOT fork the gate model. It projects the spec's ten
// side-effect levels onto the existing three gate tiers (lib/gates.ts) so that
// commands, agents, API keys, and extensions all resolve authorization through the
// SAME primitive. This module is pure (no I/O) and fully tested; the command
// runtime and the engine consume its classification and then defer Tier-2 mandate
// pre-authorization to `gateDecision` exactly as they do today.
//
// Load-bearing invariant: `capital-binding` and `transaction-execution` are ALWAYS
// Tier 3 — non-delegable human approval — for every actor, including extensions.
// No classification, mandate, or manifest can lower them.

import type { GateTier } from "@/lib/gates";

/** The ten side-effect levels a terminal command / agent / extension can declare. */
export type SideEffectLevel =
  | "read-only"
  | "local-draft"
  | "internal-write"
  | "external-communication"
  | "external-data-write"
  | "capital-analysis"
  | "capital-binding"
  | "transaction-execution"
  | "compliance-sensitive"
  | "destructive";

export type ApprovalRequirement = "none" | "operator" | "human_nondelegable";

export interface ActionClassification {
  level: SideEffectLevel;
  /** The gate tier this level resolves to. */
  tier: GateTier;
  /** none = run when authorized; operator = Tier-2 sign-off unless a mandate
   *  pre-authorizes; human_nondelegable = Tier-3, never delegable/automatable. */
  approval: ApprovalRequirement;
  /** True when the action may run immediately for an authorized caller with no
   *  approval step (read-only work and internal drafts/analysis). */
  executesImmediately: boolean;
  /** True when the effect can be undone (drives whether `rollback` is offered). */
  reversible: boolean;
  /** True when a preview/dry-run must be shown before execution. */
  requiresPreview: boolean;
}

// The single source of truth. Every level maps to exactly one tier + approval mode.
// Tier-3 rows can never be softened; the resolver below re-asserts that.
const TABLE: Record<SideEffectLevel, Omit<ActionClassification, "level">> = {
  "read-only":             { tier: 1, approval: "none",              executesImmediately: true,  reversible: true,  requiresPreview: false },
  "local-draft":           { tier: 1, approval: "none",              executesImmediately: true,  reversible: true,  requiresPreview: false },
  "internal-write":        { tier: 1, approval: "none",              executesImmediately: true,  reversible: true,  requiresPreview: false },
  "capital-analysis":      { tier: 1, approval: "none",              executesImmediately: true,  reversible: true,  requiresPreview: false },
  "external-communication":{ tier: 2, approval: "operator",         executesImmediately: false, reversible: false, requiresPreview: true },
  "external-data-write":   { tier: 2, approval: "operator",         executesImmediately: false, reversible: false, requiresPreview: true },
  "compliance-sensitive":  { tier: 2, approval: "operator",         executesImmediately: false, reversible: false, requiresPreview: true },
  "destructive":           { tier: 2, approval: "operator",         executesImmediately: false, reversible: false, requiresPreview: true },
  "capital-binding":       { tier: 3, approval: "human_nondelegable", executesImmediately: false, reversible: false, requiresPreview: true },
  "transaction-execution": { tier: 3, approval: "human_nondelegable", executesImmediately: false, reversible: false, requiresPreview: true },
};

/** Classify a side-effect level into its tier + approval requirement. Pure. */
export function classifySideEffect(level: SideEffectLevel): ActionClassification {
  const base = TABLE[level];
  // Defensive re-assertion of the non-delegable invariant: a Tier-3 level can
  // never present as anything but human_nondelegable, regardless of table edits.
  const approval: ApprovalRequirement =
    base.tier === 3 ? "human_nondelegable" : base.approval;
  return { level, ...base, approval };
}

/** True when the level needs some approval before it can take effect. */
export function requiresApproval(level: SideEffectLevel): boolean {
  return classifySideEffect(level).approval !== "none";
}

/** True when the level can NEVER be delegated or automated — always a human. */
export function isNonDelegable(level: SideEffectLevel): boolean {
  return classifySideEffect(level).approval === "human_nondelegable";
}

/** The gate tier a level resolves to (1/2/3). */
export function tierForSideEffect(level: SideEffectLevel): GateTier {
  return classifySideEffect(level).tier;
}

/** The verbs a command of this level may offer (drives the terminal UI). */
export function verbsFor(level: SideEffectLevel): string[] {
  const c = classifySideEffect(level);
  const verbs = ["explain"];
  if (c.executesImmediately) verbs.push("run");
  else verbs.push("dry-run", "preview", "approve", "reject", "revise");
  if (c.reversible) verbs.push("rollback");
  verbs.push("escalate", "export-audit");
  return verbs;
}

export const ALL_SIDE_EFFECT_LEVELS: SideEffectLevel[] = Object.keys(TABLE) as SideEffectLevel[];
