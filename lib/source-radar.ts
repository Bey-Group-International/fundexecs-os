// lib/source-radar.ts
// The Source Radar — the compounding layer over the four sourcing-intelligence
// clusters. Each cluster is strong alone; the radar fuses them into a single
// ranked "act now" read:
//
//   WHO      — the first-party entity catalog (sourcing-intel, migration 0042)
//   WHY NOW  — market signals + sell/raise propensity (sourcing-signals, 0055)
//   WHY US   — mandate/thesis fit carried on each entity
//   NEXT     — a recommended move that routes INTO the right cluster:
//              sell-leaning company → Buyers (ownership, 0056);
//              raise-leaning allocator → Outreach (0057);
//              strong-fit & not yet tracked → add to pipeline.
//
// That routing is the compounding: a signal doesn't just sit in a feed, it points
// the operator at the cluster that acts on it. Scoring is pure + deterministic
// (works with no key, in CI); the DB compositor only gathers + joins.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { EntityKind } from "@/lib/sourcing-intel";
import {
  listSignals,
  propensityScore,
  summarizeSignals,
  type Propensity,
  type SignalRecord,
  type SignalType,
} from "@/lib/sourcing-signals";

type Client = SupabaseClient<Database>;
const DAY = 24 * 60 * 60 * 1000;

// Where a recommended move sends the operator — each maps to an existing cluster.
export type RadarMoveKind = "pipeline" | "buyers" | "outreach" | "signals" | "research";

export interface RadarMove {
  label: string;
  kind: RadarMoveKind;
  /** Deep-link into the owning cluster surface (omitted for the inline pipeline add). */
  href?: string;
}

export interface RadarItem {
  entityId: string | null;
  name: string;
  kind: string;
  categories: string[];
  geography: string | null;
  description: string | null;
  sourceUrl: string | null;
  inPipeline: boolean;
  fit: number; // 0–100 mandate fit carried from discovery
  propensity: Propensity;
  signalCount: number;
  signalSummary: string;
  recency: number; // 0–100, freshness of the most recent signal
  score: number; // 0–100 composite priority
  move: RadarMove;
}

// ===========================================================================
// PURE — scoring + routing (no DB, no key, unit-testable)
// ===========================================================================

// Freshness of a signal in 0–100: full credit inside a week, linear decay to 0
// by ~90 days. No date → 0. Pure.
export function recencyScore(dateIso: string | null | undefined, now: number = Date.now()): number {
  if (!dateIso) return 0;
  const t = new Date(dateIso).getTime();
  if (!Number.isFinite(t)) return 0;
  const days = (now - t) / DAY;
  if (days <= 7) return 100;
  if (days >= 90) return 0;
  return Math.round(100 * (1 - (days - 7) / (90 - 7)));
}

export interface RadarScoreInput {
  fit: number;
  propensity: Propensity;
  recency: number;
  signalCount: number;
}

// Composite priority. "Why now" (propensity) leads, "why us" (fit) anchors,
// freshness and corroboration (signal count, diminishing) round it out. An entity
// with no signals scores on fit alone, so signal-bearing targets rise to the top.
// Pure + deterministic.
export function radarScore({ fit, propensity, recency, signalCount }: RadarScoreInput): number {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const pMax = Math.max(clamp(propensity.sell), clamp(propensity.raise));
  const corroboration = Math.min(100, signalCount * 25);
  const score =
    0.45 * pMax + 0.25 * clamp(fit) + 0.15 * clamp(recency) + 0.15 * corroboration;
  return Math.round(score);
}

// The recommended next move — the routing that makes the clusters compound.
// Sell-leaning company → find buyers; raise-leaning allocator → outreach;
// strong-fit untracked entity → add to pipeline; otherwise keep watching. Pure.
export function recommendMove(item: {
  name: string;
  kind: string;
  propensity: Propensity;
  fit: number;
  inPipeline: boolean;
}): RadarMove {
  const q = encodeURIComponent(item.name);
  const isCompany = item.kind === "company";
  const isAllocator = item.kind === "investor" || item.kind === "fund";

  if (item.propensity.sell >= 50 && isCompany) {
    return { label: "Find buyers", kind: "buyers", href: `/source/buyers?q=${q}` };
  }
  if (item.propensity.raise >= 50 && isAllocator) {
    return { label: "Start outreach", kind: "outreach", href: `/source/outreach` };
  }
  if (!item.inPipeline && item.fit >= 55) {
    return { label: "Add to pipeline", kind: "pipeline" };
  }
  if (item.propensity.sell >= 50 || item.propensity.raise >= 50) {
    return { label: "Start outreach", kind: "outreach", href: `/source/outreach` };
  }
  return { label: "Watch signals", kind: "signals", href: `/source/signals?q=${q}` };
}

// ===========================================================================
// DB compositor — gather catalog + signals, join, rank
// ===========================================================================
interface EntityRow {
  id: string;
  kind: string;
  name: string;
  categories: string[] | null;
  geography: string | null;
  description: string | null;
  source_url: string | null;
  provenance: string;
  metadata: Record<string, unknown> | null;
}

function fitOf(row: EntityRow): number {
  const f = row.metadata?.fitScore;
  const n = typeof f === "number" ? f : Number(f);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
}

function inPipelineOf(row: EntityRow): boolean {
  return row.provenance === "pipeline" || Boolean(row.metadata?.pipeline_id);
}

/**
 * Build the ranked radar for an org: pull the catalog + recent signals, join them
 * (by entity id, falling back to name), compute propensity + freshness + the
 * composite priority, and attach the routing move. Best-effort and read-only.
 */
export async function buildRadar(
  supabase: Client,
  orgId: string,
  opts: { kind?: EntityKind | null; limit?: number } = {},
): Promise<RadarItem[]> {
  const limit = opts.limit ?? 20;
  let entities: EntityRow[] = [];
  try {
    let q = supabase
      .from("sourcing_entities")
      .select("id, kind, name, categories, geography, description, source_url, provenance, metadata")
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(250);
    if (opts.kind) q = q.eq("kind", opts.kind);
    const { data } = await q;
    entities = (data ?? []) as unknown as EntityRow[];
  } catch {
    entities = [];
  }
  if (entities.length === 0) return [];

  const signals = await listSignals(supabase, orgId, { limit: 400 });
  const byId = new Map<string, SignalRecord[]>();
  const byName = new Map<string, SignalRecord[]>();
  for (const s of signals) {
    if (s.entityId) byId.set(s.entityId, [...(byId.get(s.entityId) ?? []), s]);
    const key = s.subjectName.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), s]);
  }

  const now = Date.now();
  const items: RadarItem[] = entities.map((row) => {
    const sigs = byId.get(row.id) ?? byName.get(row.name.trim().toLowerCase()) ?? [];
    const forScore = sigs.map((s) => ({ signalType: s.signalType as SignalType, strength: s.strength }));
    const propensity = propensityScore({ kind: row.kind }, forScore);
    const recency = sigs.reduce((m, s) => Math.max(m, recencyScore(s.occurredAt ?? s.createdAt, now)), 0);
    const fit = fitOf(row);
    const inPipeline = inPipelineOf(row);
    const score = radarScore({ fit, propensity, recency, signalCount: sigs.length });
    return {
      entityId: row.id,
      name: row.name,
      kind: row.kind,
      categories: row.categories ?? [],
      geography: row.geography,
      description: row.description,
      sourceUrl: row.source_url,
      inPipeline,
      fit,
      propensity,
      signalCount: sigs.length,
      signalSummary: sigs.length ? summarizeSignals(forScore) : "No signals yet — scan to surface triggers.",
      recency,
      score,
      move: recommendMove({ name: row.name, kind: row.kind, propensity, fit, inPipeline }),
    };
  });

  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const __test = {
  recencyScore,
  radarScore,
  recommendMove,
};
