// lib/radar-attribution.ts
// Radar → outcome attribution — close the loop on the Source Radar.
//
// The radar recommends a move (buyers / outreach / pipeline / signals / research)
// and the operator either accepts or dismisses it (radar_feedback, migration 0061).
// The Outcome Funnel (lib/source-funnel.ts) separately measures how the whole suite
// converts sourced → contacted → replied → met → mandate. This module joins the two:
// it takes every ACCEPTED radar move and traces the entity it pointed at forward
// through those SAME funnel stages, so an operator can finally see which
// recommendations actually convert — not just which got clicked.
//
// The four progression stages mirror the funnel exactly (the funnel's "sourced" is
// implicit here: an accepted move IS the entry point, so we measure from accepted):
//
//   accepted  — the operator accepted the radar's recommended move (the entry point)
//   contacted — that entity was enrolled + touched via outreach (outreach_enrollments)
//   replied   — the counterparty wrote back (messaging thread, or enrollment 'replied')
//   met       — a meeting got scheduled (inbox booking/video, or a set meeting_at)
//   mandate   — the relationship became a real deal (deals)
//
// MIRRORS lib/source-funnel.ts: the stage signals (isContacted / isReplied / isMet /
// hasMandate) reuse the funnel's own definitions so attribution and the funnel never
// disagree. The math is PURE + deterministic (attributeStage, rollupByMoveKind,
// summarizeAttribution — no DB, no key, runnable in CI); only buildAttribution touches
// Supabase, best-effort + read-only exactly like buildFunnel/buildRadar. Adds NO
// migration and does NOT modify database.types.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { RadarMoveKind } from "@/lib/source-radar";

type Client = SupabaseClient<Database>;

// ===========================================================================
// Shapes
// ===========================================================================

// The five attribution stages, in order. The first is the entry point (an accepted
// recommendation); the rest mirror the funnel's progression stages 1:1.
export type AttributionStage = "accepted" | "contacted" | "replied" | "met" | "mandate";

export const ATTRIBUTION_STAGES: AttributionStage[] = [
  "accepted",
  "contacted",
  "replied",
  "met",
  "mandate",
];

export const ATTRIBUTION_STAGE_LABELS: Record<AttributionStage, string> = {
  accepted: "Accepted",
  contacted: "Contacted",
  replied: "Replied",
  met: "Met",
  mandate: "Mandate",
};

// The move kinds we attribute over — mirrors RadarMoveKind so every recommendation
// the radar can make has a row, even at zero.
export const MOVE_KINDS: RadarMoveKind[] = [
  "pipeline",
  "buyers",
  "outreach",
  "signals",
  "research",
];

export const MOVE_KIND_LABELS: Record<RadarMoveKind, string> = {
  pipeline: "Add to pipeline",
  buyers: "Find buyers",
  outreach: "Start outreach",
  signals: "Watch signals",
  research: "Research",
};

// Per-move-kind attribution: of the moves accepted for this kind, how many of those
// entities reached each downstream stage, plus the headline accepted → mandate rate.
export interface MoveAttribution {
  moveKind: RadarMoveKind;
  label: string;
  accepted: number;
  contacted: number;
  replied: number;
  met: number;
  mandate: number;
  // mandate / accepted as a 0–100 conversion for this move kind.
  conversion: number;
}

// A stage-to-stage conversion across the attribution funnel (accepted → … → mandate),
// the absolute counts and the rate (0–100). `rate` is 0 when the prior stage is empty.
export interface AttributionConversion {
  from: AttributionStage;
  to: AttributionStage;
  fromCount: number;
  toCount: number;
  rate: number; // 0–100
}

// The full attribution read for an org.
export interface Attribution {
  // Stage tallies summed across all accepted moves.
  counts: Record<AttributionStage, number>;
  conversions: AttributionConversion[];
  // The headline: accepted radar moves → mandate, 0–100.
  overallConversion: number;
  byMoveKind: MoveAttribution[];
}

// ===========================================================================
// PURE — attribution math (no DB, no key, unit-testable)
// ===========================================================================

const clampPct = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

/**
 * A safe percentage: numerator / denominator × 100, rounded to a 0–100 integer.
 * Divide-by-zero (and any non-finite input) yields 0 rather than NaN/Infinity. Pure.
 * Matches lib/source-funnel.ts `pct` semantics so the two surfaces agree.
 */
export function pct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return clampPct((numerator / denominator) * 100);
}

// Normalize a name for cross-table joins (radar_feedback.entity_name ↔ enrollment
// subject_name ↔ thread counterparty_name ↔ deal name). Lower-cased + collapsed
// whitespace; empty/blank → "". Pure.
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// What an entity reached downstream — the furthest funnel stage observed. Each flag
// is independent (a deal implies mandate without requiring an observed reply), so the
// attribution counts are independent tallies just like the funnel's.
export interface EntityProgress {
  contacted: boolean;
  replied: boolean;
  met: boolean;
  mandate: boolean;
}

export const NO_PROGRESS: EntityProgress = {
  contacted: false,
  replied: false,
  met: false,
  mandate: false,
};

// One accepted radar move, reduced to what attribution needs: which kind it was and
// how to identify the entity it pointed at.
export interface AcceptedMove {
  entityId: string | null;
  entityName: string | null;
  moveKind: RadarMoveKind | null;
}

/**
 * The furthest stage an entity reached, given its progress flags. Returns the highest
 * stage whose flag is set, falling back to "accepted" (the entry point is always
 * reached for an accepted move). Pure + deterministic.
 */
export function furthestStage(p: EntityProgress): AttributionStage {
  if (p.mandate) return "mandate";
  if (p.met) return "met";
  if (p.replied) return "replied";
  if (p.contacted) return "contacted";
  return "accepted";
}

/**
 * Roll a set of accepted moves + their per-entity progress into per-move-kind
 * attribution. Every move kind in MOVE_KINDS gets a row (zero-filled) so the output
 * is stable regardless of which kinds appear in the data. Moves with a null/unknown
 * kind are ignored (we can't attribute them to a recommendation type). Counts are
 * independent tallies per stage. Deterministic — sorted by accepted desc, then kind.
 *
 * `progressOf` maps an accepted move to its observed downstream progress; the caller
 * (buildAttribution) supplies the DB-derived join, tests supply a stub.
 */
export function rollupByMoveKind(
  moves: AcceptedMove[],
  progressOf: (m: AcceptedMove) => EntityProgress,
): MoveAttribution[] {
  const byKind = new Map<RadarMoveKind, MoveAttribution>();
  for (const kind of MOVE_KINDS) {
    byKind.set(kind, {
      moveKind: kind,
      label: MOVE_KIND_LABELS[kind],
      accepted: 0,
      contacted: 0,
      replied: 0,
      met: 0,
      mandate: 0,
      conversion: 0,
    });
  }

  for (const m of moves) {
    if (!m.moveKind) continue;
    const row = byKind.get(m.moveKind);
    if (!row) continue; // unknown kind not in our enum — skip rather than throw.
    row.accepted += 1;
    const p = progressOf(m);
    if (p.contacted) row.contacted += 1;
    if (p.replied) row.replied += 1;
    if (p.met) row.met += 1;
    if (p.mandate) row.mandate += 1;
  }

  const rows = [...byKind.values()].map((r) => ({ ...r, conversion: pct(r.mandate, r.accepted) }));
  rows.sort((a, b) => b.accepted - a.accepted || a.moveKind.localeCompare(b.moveKind));
  return rows;
}

/**
 * Sum per-move-kind attribution into the org-wide stage counts (accepted → mandate).
 * Pure + deterministic.
 */
export function totalCounts(rows: MoveAttribution[]): Record<AttributionStage, number> {
  const counts: Record<AttributionStage, number> = {
    accepted: 0,
    contacted: 0,
    replied: 0,
    met: 0,
    mandate: 0,
  };
  for (const r of rows) {
    counts.accepted += r.accepted;
    counts.contacted += r.contacted;
    counts.replied += r.replied;
    counts.met += r.met;
    counts.mandate += r.mandate;
  }
  return counts;
}

/**
 * Stage-to-stage conversion across the ordered attribution funnel: for each adjacent
 * pair, the rate at which the prior stage carries into the next. An empty prior stage
 * gives 0% (never divides by zero). Pure + deterministic.
 */
export function attributionConversions(
  counts: Record<AttributionStage, number>,
): AttributionConversion[] {
  const out: AttributionConversion[] = [];
  for (let i = 0; i < ATTRIBUTION_STAGES.length - 1; i++) {
    const from = ATTRIBUTION_STAGES[i];
    const to = ATTRIBUTION_STAGES[i + 1];
    const fromCount = counts[from] ?? 0;
    const toCount = counts[to] ?? 0;
    out.push({ from, to, fromCount, toCount, rate: pct(toCount, fromCount) });
  }
  return out;
}

/**
 * The headline number: accepted → mandate, as a 0–100 rate. 0 when nothing was
 * accepted (no divide-by-zero). Pure.
 */
export function overallConversion(counts: Record<AttributionStage, number>): number {
  return pct(counts.mandate ?? 0, counts.accepted ?? 0);
}

/**
 * Assemble the pure attribution summary from accepted moves + the progress join.
 * Deterministic — same inputs, same output. buildAttribution calls this after
 * gathering from the DB; tests call it directly with a stub progress function.
 */
export function summarizeAttribution(
  moves: AcceptedMove[],
  progressOf: (m: AcceptedMove) => EntityProgress,
): Attribution {
  const byMoveKind = rollupByMoveKind(moves, progressOf);
  const counts = totalCounts(byMoveKind);
  return {
    counts,
    conversions: attributionConversions(counts),
    overallConversion: overallConversion(counts),
    byMoveKind,
  };
}

// The empty attribution — a zeroed read with every move kind present. Used for an
// empty org and as the best-effort fallback. Pure (computed from constants).
export const EMPTY_ATTRIBUTION: Attribution = summarizeAttribution([], () => NO_PROGRESS);

// ===========================================================================
// Stage signals — REUSED from the funnel's definitions (kept in lock-step)
// ===========================================================================
// These mirror lib/source-funnel.ts exactly. They are duplicated (not imported)
// because the funnel keeps them module-private; the header note on source-funnel.ts
// asks callers to REUSE its stage definitions, which we do by replicating the same
// predicates here so attribution and the funnel classify an entity identically.

interface EnrollmentRow {
  entity_id: string | null;
  subject_name: string | null;
  status: string | null;
  current_step: number | null;
}
interface ThreadRow {
  category: string | null;
  counterparty_name: string | null;
  meeting_at: string | null;
}
interface DealRow {
  name: string | null;
}

// An enrollment counts as "contacted" once at least one step has been sent
// (current_step >= 1) or it has moved past the unsent state — same as the funnel.
function isContacted(e: EnrollmentRow): boolean {
  if ((e.current_step ?? 0) >= 1) return true;
  return e.status === "replied" || e.status === "completed" || e.status === "stopped";
}

// An enrollment counts as "replied" when its status says so — same as the funnel.
function isRepliedEnrollment(e: EnrollmentRow): boolean {
  return e.status === "replied";
}

// MET — the funnel's pragmatic definition: there is no dedicated meetings table, so
// the inbox is where scheduling lives. A thread is a meeting when it carries a
// concrete time (meeting_at) OR rides the booking/video lanes.
function isMetThread(t: ThreadRow): boolean {
  if (t.meeting_at) return true;
  return t.category === "booking" || t.category === "video";
}

// A messaging thread is the reply signal — same as the funnel.
function isReplyThread(t: ThreadRow): boolean {
  return t.category === "messaging";
}

// ===========================================================================
// DB compositor — gather accepted moves + downstream progress, best-effort
// ===========================================================================

interface FeedbackRow {
  entity_id: string | null;
  entity_name: string | null;
  move_kind: string | null;
  action: string | null;
}

// Coerce a raw move_kind string into our enum, or null if it isn't one we know.
function asMoveKind(s: string | null): RadarMoveKind | null {
  return s && (MOVE_KINDS as string[]).includes(s) ? (s as RadarMoveKind) : null;
}

/**
 * Build the org's radar → outcome attribution: take every ACCEPTED radar_feedback
 * row, and for each pointed-at entity trace how far it progressed through the funnel
 * stages — joining outreach / inbox / deals by entity id first, then by normalized
 * name. Produces per-move-kind progression + conversion and the headline accepted →
 * mandate rate.
 *
 * Best-effort + read-only — every read is wrapped so a missing or unreadable table
 * degrades that signal to "not reached" rather than throwing (mirrors buildFunnel /
 * buildRadar). Returns EMPTY_ATTRIBUTION when nothing has been accepted.
 */
export async function buildAttribution(supabase: Client, orgId: string): Promise<Attribution> {
  // --- the entry points: accepted radar recommendations -------------------
  let feedback: FeedbackRow[] = [];
  try {
    const { data } = await supabase
      .from("radar_feedback")
      .select("entity_id, entity_name, move_kind, action")
      .eq("organization_id", orgId)
      .eq("action", "accepted")
      .limit(5000);
    feedback = (data ?? []) as unknown as FeedbackRow[];
  } catch {
    feedback = [];
  }

  const accepted: AcceptedMove[] = feedback.map((f) => ({
    entityId: f.entity_id,
    entityName: f.entity_name,
    moveKind: asMoveKind(f.move_kind),
  }));
  if (accepted.length === 0) return EMPTY_ATTRIBUTION;

  // --- contacted + replied(enrollment): the outreach cluster --------------
  let enrollments: EnrollmentRow[] = [];
  try {
    const { data } = await supabase
      .from("outreach_enrollments")
      .select("entity_id, subject_name, status, current_step")
      .eq("organization_id", orgId)
      .limit(5000);
    enrollments = (data ?? []) as unknown as EnrollmentRow[];
  } catch {
    enrollments = [];
  }

  // --- replied + met: the inbox -------------------------------------------
  let threads: ThreadRow[] = [];
  try {
    const { data } = await supabase
      .from("inbox_threads")
      .select("category, counterparty_name, meeting_at")
      .eq("organization_id", orgId)
      .limit(5000);
    threads = (data ?? []) as unknown as ThreadRow[];
  } catch {
    threads = [];
  }

  // --- mandate: the deal graph --------------------------------------------
  let deals: DealRow[] = [];
  try {
    const { data } = await supabase
      .from("deals")
      .select("name")
      .eq("organization_id", orgId)
      .limit(5000);
    deals = (data ?? []) as unknown as DealRow[];
  } catch {
    deals = [];
  }

  // --- build the progress join indexes ------------------------------------
  // Contacted / replied signals from outreach, keyed by entity_id and by name.
  const contactedById = new Set<string>();
  const contactedByName = new Set<string>();
  const repliedById = new Set<string>();
  const repliedByName = new Set<string>();
  for (const e of enrollments) {
    const nm = normalizeName(e.subject_name);
    if (isContacted(e)) {
      if (e.entity_id) contactedById.add(e.entity_id);
      if (nm) contactedByName.add(nm);
    }
    if (isRepliedEnrollment(e)) {
      if (e.entity_id) repliedById.add(e.entity_id);
      if (nm) repliedByName.add(nm);
    }
  }

  // Replied / met signals from the inbox, keyed by counterparty name (threads carry
  // no entity_id, so name is the only join available — same fuzziness the radar uses).
  const repliedThreadByName = new Set<string>();
  const metByName = new Set<string>();
  for (const t of threads) {
    const nm = normalizeName(t.counterparty_name);
    if (!nm) continue;
    if (isReplyThread(t)) repliedThreadByName.add(nm);
    if (isMetThread(t)) metByName.add(nm);
  }

  // Mandate signal from deals, keyed by name (deals carry no entity_id link here).
  const mandateByName = new Set<string>();
  for (const d of deals) {
    const nm = normalizeName(d.name);
    if (nm) mandateByName.add(nm);
  }

  // Resolve one accepted move to its furthest-observed progress.
  const progressOf = (m: AcceptedMove): EntityProgress => {
    const id = m.entityId;
    const nm = normalizeName(m.entityName);
    const contacted =
      (id ? contactedById.has(id) : false) || (nm ? contactedByName.has(nm) : false);
    const replied =
      (id ? repliedById.has(id) : false) ||
      (nm ? repliedByName.has(nm) || repliedThreadByName.has(nm) : false);
    const met = nm ? metByName.has(nm) : false;
    const mandate = nm ? mandateByName.has(nm) : false;
    return { contacted, replied, met, mandate };
  };

  return summarizeAttribution(accepted, progressOf);
}

export const __test = {
  pct,
  normalizeName,
  furthestStage,
  rollupByMoveKind,
  totalCounts,
  attributionConversions,
  overallConversion,
  summarizeAttribution,
};
