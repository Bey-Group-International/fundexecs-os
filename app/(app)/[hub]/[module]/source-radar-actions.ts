"use server";

import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { buildRadar, type RadarItem } from "@/lib/source-radar";
import { signalsLive, generateSignals, recordSignals } from "@/lib/sourcing-signals";
import type { EntityKind } from "@/lib/sourcing-intel";

export interface RadarResult {
  ok: boolean;
  items?: RadarItem[];
  live?: boolean;
  error?: string;
}

// The compounding read: catalog × signals × fit → one ranked "act now" list,
// each row routed to the cluster that acts on it (buyers / outreach / pipeline).
export async function loadRadar(kind?: EntityKind | null): Promise<RadarResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();
  const items = await buildRadar(supabase, auth.ctx.orgId, { kind: kind ?? null });
  return { ok: true, items, live: signalsLive() };
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
  const supabase = createServerClient();

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
