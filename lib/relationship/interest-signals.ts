// lib/relationship/interest-signals.ts
// Interest routing for the Relationship Intelligence Engine. Surfaces first-
// party intent — who is engaging with the org's deal shares, data room, and
// marketplace listings — as warm, high-intent signals to route into the
// prospecting pipeline. Native: reads existing engagement tables, no external
// service. scoreIntent / summarizeSignals are pure (unit-tested); now is passed
// in for determinism.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type SignalSource = "deal_share" | "data_room" | "marketplace" | "portal";

export interface RawSignal {
  source: SignalSource;
  party?: string | null; // an identifiable engaging party, when the event has one
  createdAt: string;
}

export interface PartyIntent {
  party: string;
  events: number;
  lastAt: string;
  intent: number; // 0–100
}

export interface SignalsSummary {
  totals: Record<SignalSource, number> & { total: number };
  parties: PartyIntent[]; // highest-intent first
}

const DAY_MS = 86_400_000;

// Intent from frequency + recency. Frequent, recent engagement scores highest.
export function scoreIntent(events: number, lastAtMs: number, nowMs: number): number {
  const freq = Math.min(60, events * 15);
  const days = Math.max(0, (nowMs - lastAtMs) / DAY_MS);
  const recency = days <= 3 ? 40 : days <= 7 ? 30 : days <= 30 ? 15 : 5;
  return Math.min(100, Math.round(freq + recency));
}

// Aggregate raw signals into per-source totals and a ranked list of the
// identifiable engaging parties.
export function summarizeSignals(raw: RawSignal[], nowMs: number): SignalsSummary {
  const totals: Record<SignalSource, number> & { total: number } = {
    deal_share: 0,
    data_room: 0,
    marketplace: 0,
    portal: 0,
    total: 0,
  };
  const byParty = new Map<string, { events: number; lastMs: number; lastAt: string }>();

  for (const s of raw) {
    totals[s.source] += 1;
    totals.total += 1;
    const party = (s.party ?? "").trim();
    if (!party) continue;
    const ms = Date.parse(s.createdAt);
    const at = Number.isNaN(ms) ? 0 : ms;
    const cur = byParty.get(party);
    if (!cur || at > cur.lastMs) {
      byParty.set(party, { events: (cur?.events ?? 0) + 1, lastMs: at, lastAt: s.createdAt });
    } else {
      cur.events += 1;
    }
  }

  const parties: PartyIntent[] = [...byParty.entries()]
    .map(([party, v]) => ({ party, events: v.events, lastAt: v.lastAt, intent: scoreIntent(v.events, v.lastMs, nowMs) }))
    .sort((a, b) => b.intent - a.intent || b.events - a.events);

  return { totals, parties };
}

function loose(db: SupabaseClient<Database>): SupabaseClient {
  return db as unknown as SupabaseClient;
}

const PER_SOURCE_LIMIT = 200;

// Load the org's recent intent signals across engagement surfaces. RLS-scoped;
// never throws (returns an empty summary on failure). `nowMs` defaults to the
// current time; callers/tests may pass a fixed value.
export async function loadInterestSignals(
  db: SupabaseClient<Database>,
  orgId: string,
  nowMs: number = Date.now(),
): Promise<SignalsSummary> {
  const client = loose(db);
  const raw: RawSignal[] = [];

  const push = async (
    table: string,
    source: SignalSource,
    columns: string,
    partyKey?: string,
  ) => {
    try {
      const { data } = await client
        .from(table)
        .select(columns)
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(PER_SOURCE_LIMIT);
      for (const row of ((data ?? []) as unknown) as Record<string, unknown>[]) {
        raw.push({
          source,
          party: partyKey ? (row[partyKey] as string | null) : null,
          createdAt: String(row["created_at"] ?? ""),
        });
      }
    } catch {
      // A missing/absent surface just contributes no signals.
    }
  };

  // deal_share_views carries a viewer_label — the one surface with an
  // identifiable engaging party.
  await push("deal_share_views", "deal_share", "viewer_label, created_at", "viewer_label");
  await push("data_room_views", "data_room", "created_at");
  await push("marketplace_interests", "marketplace", "created_at");
  await push("investor_portal_views", "portal", "created_at");

  return summarizeSignals(raw, nowMs);
}
