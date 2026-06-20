// lib/engagement.ts
// The relationship feedback loop. Every external move the operator makes against
// an investor (an outreach, an intro request, a diligence pack) is recorded back
// onto the relationship graph as an "engaged" edge whose strength compounds. The
// Capital Map then reads that signal to lift the investor's warmth and to treat
// them as a directly-reachable contact — so acting on the map makes the map
// smarter over time.
//
// The pure helpers (boost / temperature floor) are unit-tested; the writer is a
// thin, defensive read-then-upsert over the existing `relationships` table (no
// new schema — engagement is just a typed edge).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { Temperature } from "@/lib/capital-map";

type Client = SupabaseClient<Database>;

// The edge relation that marks operator → investor engagement.
export const ENGAGEMENT_RELATION = "engaged";

// External action kinds worth recording as engagement. Internal drafts (Tier 1
// work product) don't touch the counterparty, so they don't warm a relationship.
const ENGAGING_ACTIONS = new Set([
  "send_outreach",
  "send_intro_request",
  "share_materials",
  "send_diligence_request",
  "distribute_report",
]);

export function isEngagingAction(action: string): boolean {
  return ENGAGING_ACTIONS.has(action);
}

// Pure: how much accumulated engagement should lift warmth (0..15). Diminishing
// returns — the first real touch matters most.
export function engagementBoost(count: number): number {
  if (count <= 0) return 0;
  return Math.min(15, Math.round(8 * Math.log2(count + 1)));
}

// Pure: an investor you've actually engaged can't still read as stone cold.
export function floorTemperatureByEngagement(temp: Temperature, count: number): Temperature {
  if (count > 0 && temp === "cold") return "warm";
  return temp;
}

/**
 * Record an engagement against an investor by upserting an "engaged" edge from
 * the operator's organization to the investor and bumping its strength + count.
 * Idempotent per (org, investor): repeated outreach strengthens the same edge
 * rather than spawning duplicates. Best-effort — failures never block dispatch.
 */
export async function recordEngagement(
  supabase: Client,
  args: { orgId: string; investorId: string; action: string },
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("relationships")
      .select("id, strength, metadata")
      .eq("graph", "relationship")
      .eq("relation", ENGAGEMENT_RELATION)
      .eq("from_entity_type", "organization")
      .eq("from_entity_id", args.orgId)
      .eq("to_entity_type", "investor")
      .eq("to_entity_id", args.investorId)
      .maybeSingle();

    const now = new Date().toISOString();
    if (existing) {
      const meta = (existing.metadata ?? {}) as Record<string, unknown>;
      const count = (typeof meta.count === "number" ? meta.count : 0) + 1;
      await supabase
        .from("relationships")
        .update({
          strength: Math.min(100, (existing.strength ?? 0) + 10),
          metadata: { ...meta, count, last_action: args.action, last_at: now } as Json,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("relationships").insert({
        organization_id: args.orgId,
        graph: "relationship",
        from_entity_type: "organization",
        from_entity_id: args.orgId,
        to_entity_type: "investor",
        to_entity_id: args.investorId,
        relation: ENGAGEMENT_RELATION,
        strength: 10,
        metadata: { count: 1, last_action: args.action, last_at: now } as Json,
      });
    }
  } catch {
    // Engagement is an enhancement signal, not a critical write — never let it
    // surface as a dispatch failure.
  }
}
