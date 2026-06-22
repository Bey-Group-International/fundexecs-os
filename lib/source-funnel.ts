// lib/source-funnel.ts
// The Source Outcome Funnel — the measurement layer over the sourcing suite.
// The four sourcing clusters (discovery → signals → buyers → outreach → pipeline)
// each move targets one step closer to a mandate, but until now nothing read them
// end-to-end. This funnel does: it counts how many targets reach each stage and
// what share converts from one stage to the next, so an operator can finally see
// where the suite is working and where targets fall out.
//
//   sourced   — a target exists in the discovery catalog (sourcing_entities, 0042)
//   contacted — that target was enrolled + touched via outreach (outreach_enrollments, 0060)
//   replied   — the counterparty wrote back (inbox messaging threads, 0040, or an
//               enrollment marked 'replied')
//   met       — a meeting actually got on the calendar (inbox booking/video threads
//               or any thread carrying a meeting_at) — see MET note below
//   mandate   — the relationship became a real deal/mandate (deals, 0005)
//
// MIRRORS lib/source-radar.ts: the math is PURE + deterministic (conversionRates,
// breakdownBy, summarizeFunnel — unit-testable with no DB, no key, runnable in CI);
// only buildFunnel touches Supabase, and it does so best-effort (try/catch per
// table) exactly like buildRadar, so a missing/unreadable table degrades to 0
// rather than throwing. Read-only — this adds NO migration.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

// ===========================================================================
// Shapes
// ===========================================================================

// The five funnel stages, in order. Each maps to existing data (see file header).
export type FunnelStage = "sourced" | "contacted" | "replied" | "met" | "mandate";

export const FUNNEL_STAGES: FunnelStage[] = [
  "sourced",
  "contacted",
  "replied",
  "met",
  "mandate",
];

export const STAGE_LABELS: Record<FunnelStage, string> = {
  sourced: "Sourced",
  contacted: "Contacted",
  replied: "Replied",
  met: "Met",
  mandate: "Mandate",
};

// One count per stage. Counts are independent tallies of how many targets reached
// each stage (not necessarily nested) — conversionRates derives the funnel ratios.
export type StageCounts = Record<FunnelStage, number>;

export const EMPTY_STAGE_COUNTS: StageCounts = {
  sourced: 0,
  contacted: 0,
  replied: 0,
  met: 0,
  mandate: 0,
};

// A stage-to-stage conversion: from one stage into the next, the absolute counts
// and the rate (0–100). `rate` is 0 when the prior stage is empty (no div-by-zero).
export interface StageConversion {
  from: FunnelStage;
  to: FunnelStage;
  fromCount: number;
  toCount: number;
  rate: number; // 0–100
}

// A single row of a breakdown — how a named group (a source/provenance or a
// signal type) contributed across the funnel, with its top-line conversion.
export interface BreakdownRow {
  key: string;
  label: string;
  sourced: number;
  contacted: number;
  mandate: number;
  // mandate / sourced as a 0–100 overall conversion for the group.
  conversion: number;
}

// The full funnel read for an org.
export interface Funnel {
  counts: StageCounts;
  conversions: StageConversion[];
  // overall sourced → mandate conversion, 0–100.
  overallConversion: number;
  bySource: BreakdownRow[];
  bySignal: BreakdownRow[];
}

// ===========================================================================
// PURE — funnel math (no DB, no key, unit-testable)
// ===========================================================================

const clampPct = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

/**
 * A safe percentage: numerator / denominator × 100, rounded to a 0–100 integer.
 * Divide-by-zero (and any non-finite input) yields 0 rather than NaN/Infinity.
 * Pure.
 */
export function pct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return clampPct((numerator / denominator) * 100);
}

/**
 * Stage-to-stage conversion across the ordered funnel: for each adjacent pair,
 * the rate at which the prior stage's count carries into the next. An empty prior
 * stage gives 0% (never divides by zero). Pure + deterministic.
 */
export function conversionRates(counts: StageCounts): StageConversion[] {
  const out: StageConversion[] = [];
  for (let i = 0; i < FUNNEL_STAGES.length - 1; i++) {
    const from = FUNNEL_STAGES[i];
    const to = FUNNEL_STAGES[i + 1];
    const fromCount = counts[from] ?? 0;
    const toCount = counts[to] ?? 0;
    out.push({ from, to, fromCount, toCount, rate: pct(toCount, fromCount) });
  }
  return out;
}

/**
 * The headline number: sourced → mandate, as a 0–100 conversion. 0 when nothing
 * was sourced. Pure.
 */
export function overallConversion(counts: StageCounts): number {
  return pct(counts.mandate ?? 0, counts.sourced ?? 0);
}

// What a single record contributes to a breakdown group. Stages it didn't reach
// are simply 0; grouping sums these per key.
export interface BreakdownContribution {
  key: string;
  label?: string;
  sourced?: number;
  contacted?: number;
  mandate?: number;
}

/**
 * Group contributions by key and sum each stage, then derive the group's overall
 * (mandate / sourced) conversion. Sorted by sourced volume desc, then key for a
 * stable, deterministic order. Empty input → []. Pure.
 */
export function breakdownBy(contributions: BreakdownContribution[]): BreakdownRow[] {
  const byKey = new Map<string, BreakdownRow>();
  for (const c of contributions) {
    const key = (c.key || "unknown").trim() || "unknown";
    const existing =
      byKey.get(key) ??
      ({ key, label: c.label ?? key, sourced: 0, contacted: 0, mandate: 0, conversion: 0 } as BreakdownRow);
    existing.sourced += c.sourced ?? 0;
    existing.contacted += c.contacted ?? 0;
    existing.mandate += c.mandate ?? 0;
    // Keep the first non-empty label we see for the key.
    if (c.label && existing.label === key) existing.label = c.label;
    byKey.set(key, existing);
  }
  const rows = [...byKey.values()].map((r) => ({ ...r, conversion: pct(r.mandate, r.sourced) }));
  rows.sort((a, b) => b.sourced - a.sourced || a.key.localeCompare(b.key));
  return rows;
}

/**
 * Assemble the pure funnel summary (counts + derived conversions) from raw stage
 * counts and the two breakdowns. Deterministic — same inputs, same output. The DB
 * compositor (buildFunnel) calls this after gathering; tests call it directly.
 */
export function summarizeFunnel(
  counts: StageCounts,
  bySource: BreakdownRow[] = [],
  bySignal: BreakdownRow[] = [],
): Funnel {
  return {
    counts,
    conversions: conversionRates(counts),
    overallConversion: overallConversion(counts),
    bySource,
    bySignal,
  };
}

// Pretty a provenance/source slug for display. Pure.
export function humanizeKey(s: string): string {
  return (s || "Unknown").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ===========================================================================
// DB compositor — gather the five stages + breakdowns, best-effort + read-only
// ===========================================================================
interface EntityRow {
  id: string;
  provenance: string | null;
}
interface EnrollmentRow {
  entity_id: string | null;
  status: string | null;
  current_step: number | null;
}
interface ThreadRow {
  category: string | null;
  meeting_at: string | null;
}
interface DealRow {
  source: string | null;
}
interface SignalRow {
  entity_id: string | null;
  signal_type: string | null;
}

// An enrollment counts as "contacted" once at least one step has been sent
// (current_step >= 1) or it has moved past the draft/active-but-unsent state.
function isContacted(e: EnrollmentRow): boolean {
  if ((e.current_step ?? 0) >= 1) return true;
  // 'replied'/'completed'/'stopped' all imply a touch already happened.
  return e.status === "replied" || e.status === "completed" || e.status === "stopped";
}

// An enrollment counts as "replied" when its status says so.
function isRepliedEnrollment(e: EnrollmentRow): boolean {
  return e.status === "replied";
}

// MET — pragmatic definition. There is no dedicated bookings/meetings table; the
// inbox (0040) is where scheduling lives. A thread counts as a meeting when it
// carries a concrete time (meeting_at) OR rides the booking/video lanes
// (inbox_category 'booking' | 'video') — i.e. a meeting actually got scheduled.
// Documented here so the choice is explicit rather than implied.
function isMet(t: ThreadRow): boolean {
  if (t.meeting_at) return true;
  return t.category === "booking" || t.category === "video";
}

// A messaging thread is the reply signal: the counterparty wrote back. (booking/
// video threads are counted at the met stage instead.)
function isReplyThread(t: ThreadRow): boolean {
  return t.category === "messaging";
}

/**
 * Build the org's outcome funnel: tally each of the five stages from its owning
 * table, derive the conversions, and group conversion by source/provenance and by
 * signal type. Best-effort + read-only — every read is wrapped so a missing or
 * unreadable table degrades that stage to 0 rather than throwing (mirrors
 * buildRadar). Returns a fully-zeroed funnel for an empty org.
 */
export async function buildFunnel(supabase: Client, orgId: string): Promise<Funnel> {
  // --- sourced: the discovery catalog -------------------------------------
  let entities: EntityRow[] = [];
  try {
    const { data } = await supabase
      .from("sourcing_entities")
      .select("id, provenance")
      .eq("organization_id", orgId)
      .limit(5000);
    entities = (data ?? []) as unknown as EntityRow[];
  } catch {
    entities = [];
  }

  // --- contacted + replied(enrollment): the outreach cluster --------------
  let enrollments: EnrollmentRow[] = [];
  try {
    const { data } = await supabase
      .from("outreach_enrollments")
      .select("entity_id, status, current_step")
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
      .select("category, meeting_at")
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
      .select("source")
      .eq("organization_id", orgId)
      .limit(5000);
    deals = (data ?? []) as unknown as DealRow[];
  } catch {
    deals = [];
  }

  // --- signals: for the by-signal breakdown -------------------------------
  let signals: SignalRow[] = [];
  try {
    const { data } = await supabase
      .from("entity_signals")
      .select("entity_id, signal_type")
      .eq("organization_id", orgId)
      .limit(5000);
    signals = (data ?? []) as unknown as SignalRow[];
  } catch {
    signals = [];
  }

  // --- tally the stages ----------------------------------------------------
  const contactedEnrollments = enrollments.filter(isContacted);
  const counts: StageCounts = {
    sourced: entities.length,
    contacted: contactedEnrollments.length,
    // replied = inbound messaging threads + enrollments explicitly marked replied.
    replied: threads.filter(isReplyThread).length + enrollments.filter(isRepliedEnrollment).length,
    met: threads.filter(isMet).length,
    mandate: deals.length,
  };

  // --- breakdown by source/provenance -------------------------------------
  // Sourced + contacted come from the catalog/outreach side keyed by entity
  // provenance; mandate comes from the deal's own `source` field. They share a
  // key space (provenance ≈ source), so a group shows both ends of the funnel.
  const provenanceOf = new Map<string, string>();
  for (const e of entities) provenanceOf.set(e.id, (e.provenance || "unknown").trim() || "unknown");

  const sourceContribs: BreakdownContribution[] = [];
  for (const e of entities) {
    const key = (e.provenance || "unknown").trim() || "unknown";
    sourceContribs.push({ key, label: humanizeKey(key), sourced: 1 });
  }
  for (const e of contactedEnrollments) {
    const key = (e.entity_id && provenanceOf.get(e.entity_id)) || "unknown";
    sourceContribs.push({ key, label: humanizeKey(key), contacted: 1 });
  }
  for (const d of deals) {
    const key = (d.source || "unknown").trim() || "unknown";
    sourceContribs.push({ key, label: humanizeKey(key), mandate: 1 });
  }
  const bySource = breakdownBy(sourceContribs);

  // --- breakdown by signal type -------------------------------------------
  // Which trigger types preceded outreach: an entity that has signals AND became
  // contacted contributes its signal types. Sourced credit goes to every
  // signal-bearing entity; mandate credit is approximated by signal-bearing
  // entities that were contacted (the cluster's measurable path toward a deal).
  const contactedEntityIds = new Set(
    contactedEnrollments.map((e) => e.entity_id).filter((v): v is string => Boolean(v)),
  );
  const signalContribs: BreakdownContribution[] = [];
  for (const s of signals) {
    const key = (s.signal_type || "unknown").trim() || "unknown";
    const reachedContacted = s.entity_id ? contactedEntityIds.has(s.entity_id) : false;
    signalContribs.push({
      key,
      label: humanizeKey(key),
      sourced: 1,
      contacted: reachedContacted ? 1 : 0,
    });
  }
  const bySignal = breakdownBy(signalContribs);

  return summarizeFunnel(counts, bySource, bySignal);
}

export const __test = {
  pct,
  conversionRates,
  overallConversion,
  breakdownBy,
  summarizeFunnel,
  humanizeKey,
};
