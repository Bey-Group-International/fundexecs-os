// lib/relationship/warm-intro.ts
// Warm-intro mapping for the Relationship Intelligence Engine. Given the firms a
// prospecting plan surfaces, find whether the org ALREADY knows someone there —
// the strongest existing relationship at each firm becomes a "warm path" the
// user can route an introduction through. Reuses the native Capital Network
// (network_contacts: company, strength_score, relationship_owner). The pure
// pickers are unit-tested; findWarmBridges does the RLS-scoped read.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface NetworkContactLike {
  full_name?: string | null;
  title?: string | null;
  company?: string | null;
  strength_score?: number | null;
  strength_label?: string | null;
  relationship_owner?: string | null;
  email?: string | null;
}

export interface WarmBridge {
  name: string;
  title?: string;
  company: string;
  strength: number; // 0–100
  hasOwner: boolean;
}

function toBridge(c: NetworkContactLike): WarmBridge | null {
  const name = (c.full_name ?? "").trim();
  const company = (c.company ?? "").trim();
  if (!name || !company) return null;
  return {
    name,
    title: c.title ?? undefined,
    company,
    strength: Math.max(0, Math.min(100, Math.round(c.strength_score ?? 0))),
    hasOwner: Boolean(c.relationship_owner),
  };
}

// Pick the strongest existing relationship from a set of contacts at one firm —
// the best person to route a warm introduction through. Ties break toward a
// contact with a relationship owner (someone accountable for the intro).
export function bestBridge(contacts: NetworkContactLike[]): WarmBridge | null {
  let best: WarmBridge | null = null;
  for (const c of contacts) {
    const b = toBridge(c);
    if (!b) continue;
    if (!best || b.strength > best.strength || (b.strength === best.strength && b.hasOwner && !best.hasOwner)) {
      best = b;
    }
  }
  return best;
}

// Group contacts by firm (case-insensitive) → the best warm bridge at each firm.
export function mapBridgesByFirm(contacts: NetworkContactLike[]): Map<string, WarmBridge> {
  const byFirm = new Map<string, NetworkContactLike[]>();
  for (const c of contacts) {
    const key = (c.company ?? "").trim().toLowerCase();
    if (!key) continue;
    const list = byFirm.get(key) ?? [];
    list.push(c);
    byFirm.set(key, list);
  }
  const out = new Map<string, WarmBridge>();
  for (const [key, list] of byFirm) {
    const b = bestBridge(list);
    if (b) out.set(key, b);
  }
  return out;
}

function loose(db: SupabaseClient<Database>): SupabaseClient {
  return db as unknown as SupabaseClient;
}

// For a set of firm names, return firm(lowercased) → the org's best warm bridge
// there (or nothing). RLS-scoped; never throws (returns an empty map on error).
export async function findWarmBridges(
  db: SupabaseClient<Database>,
  orgId: string,
  firmNames: string[],
): Promise<Map<string, WarmBridge>> {
  const names = Array.from(new Set(firmNames.map((n) => n.trim()).filter(Boolean)));
  if (names.length === 0) return new Map();
  try {
    const { data } = await loose(db)
      .from("network_contacts")
      .select("full_name, title, company, strength_score, strength_label, relationship_owner, email")
      .eq("organization_id", orgId)
      .in("company", names)
      .order("strength_score", { ascending: false });
    return mapBridgesByFirm((data ?? []) as NetworkContactLike[]);
  } catch {
    return new Map();
  }
}
