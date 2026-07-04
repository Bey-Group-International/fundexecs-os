"use server";

import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { buildRadar, type RadarItem, type RadarMoveKind } from "@/lib/source-radar";
import { signalsLive, generateSignals, recordSignals } from "@/lib/sourcing-signals";
import {
  computeLearnedWeights,
  type LearnedWeights,
  type RadarAggregate,
  type EngagementAggregate,
  type OutcomeAggregate,
} from "@/lib/radar-learning";
import { buildAttribution } from "@/lib/radar-attribution";
import type { EntityKind } from "@/lib/sourcing-intel";

export interface RadarResult {
  ok: boolean;
  items?: RadarItem[];
  live?: boolean;
  /** True when learned feedback weights nudged the ranking (UI "tuned" hint). */
  tuned?: boolean;
  error?: string;
}

// Aggregate this org's radar_feedback into the bounded learned weights that tune the
// ranking. Best-effort + read-only: any failure (table missing on a fresh DB, RLS,
// etc.) falls back to no weights, leaving the static base score intact.
async function loadLearnedWeights(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  orgId: string,
): Promise<LearnedWeights | null> {
  try {
    const { data } = await supabase
      .from("radar_feedback")
      .select("entity_kind, move_kind, action")
      .eq("organization_id", orgId)
      .limit(5000);
    const rows = (data ?? []) as { entity_kind: string | null; move_kind: string | null; action: string | null }[];
    if (rows.length === 0) return null;

    // Group by (entity_kind, move_kind) into accept/dismiss/snooze counts.
    const byKey = new Map<string, RadarAggregate>();
    for (const r of rows) {
      if (!r.entity_kind || !r.move_kind || !r.action) continue;
      const key = `${r.entity_kind}:${r.move_kind}`;
      const agg =
        byKey.get(key) ??
        { entityKind: r.entity_kind, moveKind: r.move_kind as RadarMoveKind, accepted: 0, dismissed: 0, snoozed: 0 };
      if (r.action === "accepted") agg.accepted += 1;
      else if (r.action === "dismissed") agg.dismissed += 1;
      else if (r.action === "snoozed") agg.snoozed += 1;
      byKey.set(key, agg);
    }

    const engagement = await loadEngagementAggregates(supabase, orgId);
    const outcomes = await loadOutcomeAggregates(supabase, orgId);
    return computeLearnedWeights([...byKey.values()], engagement, outcomes);
  } catch {
    return null;
  }
}

// Aggregate this org's radar → outcome attribution (lib/radar-attribution.ts) into
// the per-move_kind outcome buckets the learning loop folds in alongside explicit
// feedback + implicit engagement. Attribution traces every ACCEPTED recommendation
// forward through the funnel; we keep just the accepted→mandate conversion base
// (accepted volume + mandate count) per move_kind. Best-effort + read-only: any
// failure degrades to no outcomes, leaving the feedback/engagement weights intact —
// the radar must never break on attribution.
async function loadOutcomeAggregates(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  orgId: string,
): Promise<OutcomeAggregate[]> {
  try {
    const attribution = await buildAttribution(supabase, orgId);
    return attribution.byMoveKind
      .filter((m) => m.accepted > 0)
      .map((m) => ({ moveKind: m.moveKind, accepted: m.accepted, mandate: m.mandate }));
  } catch {
    return [];
  }
}

// Aggregate this org's radar_digest_engagement (implicit opens + clicks) into the
// engagement buckets the learning loop folds in alongside explicit feedback.
// Best-effort + read-only: any failure (table missing on a fresh DB, RLS) yields
// no engagement, leaving the explicit-only weights intact.
async function loadEngagementAggregates(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  orgId: string,
): Promise<EngagementAggregate[]> {
  try {
    const { data } = await supabase
      .from("radar_digest_engagement")
      .select("entity_kind, move_kind, action")
      .eq("organization_id", orgId)
      .limit(5000);
    const rows = (data ?? []) as { entity_kind: string | null; move_kind: string | null; action: string | null }[];
    if (rows.length === 0) return [];

    const byKey = new Map<string, EngagementAggregate>();
    for (const r of rows) {
      // Engagement is only learnable when attributed to a (kind, move) combo.
      if (!r.entity_kind || !r.move_kind || !r.action) continue;
      const key = `${r.entity_kind}:${r.move_kind}`;
      const agg =
        byKey.get(key) ??
        { entityKind: r.entity_kind, moveKind: r.move_kind as RadarMoveKind, clicked: 0, opened: 0 };
      if (r.action === "clicked") agg.clicked += 1;
      else if (r.action === "opened") agg.opened += 1;
      byKey.set(key, agg);
    }
    return [...byKey.values()];
  } catch {
    return [];
  }
}

// The compounding read: catalog × signals × fit → one ranked "act now" list,
// each row routed to the cluster that acts on it (buyers / outreach / pipeline),
// then tuned by the operator's own accept/dismiss feedback (the learning loop).
export async function loadRadar(kind?: EntityKind | null): Promise<RadarResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const weights = await loadLearnedWeights(supabase, auth.ctx.orgId);
  const items = await buildRadar(supabase, auth.ctx.orgId, { kind: kind ?? null, weights });
  return { ok: true, items, live: signalsLive(), tuned: weights?.active ?? false };
}

export interface RadarFeedbackInput {
  entityId?: string | null;
  entityName?: string | null;
  entityKind?: string | null;
  moveKind?: RadarMoveKind | null;
  action: "accepted" | "dismissed" | "snoozed";
  scoreAtAction?: number | null;
}

export interface RadarFeedbackResult {
  ok: boolean;
  error?: string;
}

// Capture the operator's verdict on a radar recommendation. This is the write half
// of the learning loop: each accepted/dismissed/snoozed row feeds the aggregate that
// tunes future rankings (see loadLearnedWeights → buildRadar). Org-scoped + best
// effort — a feedback write should never block the underlying action.
export async function recordRadarFeedback(input: RadarFeedbackInput): Promise<RadarFeedbackResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  try {
    const { error } = await supabase.from("radar_feedback").insert({
      organization_id: auth.ctx.orgId,
      entity_id: input.entityId ?? null,
      entity_name: input.entityName ?? null,
      entity_kind: input.entityKind ?? null,
      move_kind: input.moveKind ?? null,
      action: input.action,
      score_at_action: input.scoreAtAction ?? null,
      principal_id: auth.ctx.userId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not record feedback." };
  }
}

export interface ScanResult {
  ok: boolean;
  generated?: number;
  scanned?: number;
  error?: string;
}

// Light up the radar by generating signals for the highest-priority catalog
// entities that don't have any yet (deterministic fallback when no key). This is
// the Signals cluster feeding the radar on demand — the why-now half of the score.
export async function scanRadarSignals(limit = 10): Promise<ScanResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const orgId = auth.ctx.orgId;
  const supabase = await createServerClient();

  // Catalog entities, newest first.
  const { data: entityData } = await supabase
    .from("sourcing_entities")
    .select("id, name, kind, description")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(60);
  const entities = (entityData ?? []) as { id: string; name: string; kind: string; description: string | null }[];
  if (entities.length === 0) return { ok: true, generated: 0, scanned: 0 };

  // Which already have signals — skip them so a scan is additive, not noisy.
  const { data: sigData } = await supabase
    .from("entity_signals")
    .select("entity_id")
    .eq("organization_id", orgId)
    .not("entity_id", "is", null)
    .limit(1000);
  const haveSignals = new Set(((sigData ?? []) as { entity_id: string | null }[]).map((r) => r.entity_id));

  const targets = entities.filter((e) => !haveSignals.has(e.id)).slice(0, limit);
  let generated = 0;
  for (const e of targets) {
    const signals = await generateSignals({
      entityId: e.id,
      name: e.name,
      kind: e.kind,
      description: e.description,
    });
    if (signals.length) generated += await recordSignals(supabase, orgId, auth.ctx.userId, signals);
  }
  return { ok: true, generated, scanned: targets.length };
}
