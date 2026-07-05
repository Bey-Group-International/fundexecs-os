// lib/proactive/types.ts
// The proactive-initiative layer — typed model for Earn's self-authored work.
//
// Today a human issues every Command. This layer lets Earn generate its own
// Commands from signals nobody asked about, and run them through the SAME
// Command → Plan → Execute → Report loop (lib/engine.ts) and the SAME approval
// gates (lib/gates.ts) that operator objectives use.
//
// The pipeline is: Signal → Trigger → Prioritize → Propose(Command) →
// Plan+Draft → Surface → Gate → Learn. This file is the shared vocabulary for
// every stage. It is pure types + a couple of pure helpers — no I/O — so the
// prioritizer, gate router, and triggers can all be unit-tested in isolation.

import type { Hub } from "@/lib/supabase/database.types";
import type { ActionKind, GateTier } from "@/lib/gates";

/**
 * Two classes of signal. Internal answers "what changed in my raise?"; market
 * answers "what changed in the market that affects my raise?" A market signal
 * is grounded in an external intelligence source (PMI) and therefore its draft
 * is investor-facing at minimum (external data never auto-sends).
 */
export type SignalClass = "internal" | "market";

/**
 * The typed event a trigger emits about a subject whose state changed. Source +
 * subject + timestamp are mandatory so the feed is self-describing and
 * de-duplicable. `metadata` is an open bag for trigger-specific facts the
 * objective composer and draft need (e.g. days silent, commitment size).
 */
export interface Signal {
  /** Stable trigger key that produced this — e.g. "cold_lp". Drives learning. */
  triggerKey: string;
  hub: Hub;
  signalClass: SignalClass;
  /** The thing this is about — an investor/deal/document row. */
  subjectType: "investor" | "deal" | "document" | "fund" | "contract";
  subjectId: string | null;
  /** Self-describing subject label so a card reads without a joined row. */
  subjectName: string;
  /** One-line "why now". */
  summary: string;
  /** When the underlying state change happened (may precede detection). */
  occurredAt: string;
  /** 0–100 conviction that this is real and worth acting on, pre-PMI. */
  baseConfidence: number;
  /** 0–100 time-pressure, pre-PMI. */
  baseUrgency: number;
  metadata: Record<string, unknown>;
}

/**
 * A single intelligence-derived claim with mandatory provenance. Every fact
 * that a PMI source contributes to a draft carries source + as-of + confidence
 * so a regulated comparative statement is defensible. Mirrors the DataSource
 * envelope in lib/source-hub-types.ts but at the claim grain the draft cites.
 */
export interface ProvenancedClaim {
  /** The human-readable claim, e.g. "Top-quartile DPI of 1.8x (P82 vs 2021 vintage)". */
  claim: string;
  source: string; // "carta" | "apollo" | ...
  /** As-of date of the underlying data (ISO). */
  asOf: string;
  /** 0–1 confidence in the claim. */
  confidence: number;
  /** True only when the source verified the value (not a modeled estimate). */
  verified: boolean;
  /** Optional deep link / endpoint the claim came from. */
  ref?: string;
}

/**
 * A candidate that has passed a trigger but not yet the prioritizer. It carries
 * the signal, the PMI enrichment (if any), and the ActionKind of the outward
 * move Earn would ultimately propose (used by the gate to size blast radius).
 */
export interface ProactiveCandidate {
  signal: Signal;
  /** The outward action the surfaced item ultimately asks the operator to take. */
  sendAction: ActionKind;
  /** Intelligence claims computed BEFORE surfacing. Empty for pure-internal. */
  claims: ProvenancedClaim[];
  /** The natural-language objective Earn will author as a Command. */
  objective: string;
  /** A short, operator-facing title for the surfaced card. */
  title: string;
}

/**
 * A prioritized candidate. `priority` is the composite the trust budget ranks
 * on; `surfaced` records the budget's verdict and why.
 */
export interface RankedCandidate {
  candidate: ProactiveCandidate;
  urgency: number; // 0–100, post-PMI
  confidence: number; // 0–100, post-PMI
  blastRadius: GateTier;
  /** Learned multiplier applied from dismiss/approve history (1.0 = neutral). */
  learnedWeight: number;
  /** urgency × blastRadiusWeight × confidence × learnedWeight, 0–100. */
  priority: number;
  surfaced: boolean;
  /** Human-readable reason for the surface/suppress decision. */
  reason: string;
}

/** Status of a surfaced proactive command through its lifecycle. */
export type ProactiveStatus =
  | "surfaced" // waiting on the operator
  | "approved" // operator approved the outward send
  | "dismissed" // operator dismissed — a negative training signal
  | "snoozed" // operator deferred — a soft negative
  | "expired"; // aged out unacted

/** A verdict the operator gives a surfaced item — the training signal. */
export type ProactiveVerdict = "approved" | "dismissed" | "snoozed";

/**
 * The persisted, operator-facing item. Mirrors the proactive_commands row
 * (migration) — the surface renders this, the learn loop aggregates over it.
 */
export interface ProactiveItem {
  id: string;
  triggerKey: string;
  hub: Hub;
  signalClass: SignalClass;
  subjectName: string;
  title: string;
  rationale: string;
  urgency: number;
  confidence: number;
  blastRadius: GateTier;
  priority: number;
  status: ProactiveStatus;
  /** The workflow (Command) Earn authored and pre-ran for the draft. */
  workflowId: string | null;
  /** The pre-run draft deliverable, ready for approve/edit/send. */
  draftArtifactId: string | null;
  /** The outward ActionKind the approval would authorize. */
  sendAction: ActionKind;
  /** PMI claims embedded in the draft, with provenance, for display. */
  claims: ProvenancedClaim[];
  snoozeUntil: string | null;
  createdAt: string;
}
