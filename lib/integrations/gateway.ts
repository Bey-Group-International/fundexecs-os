// lib/integrations/gateway.ts
// The unified "merge gateway" seam — a per-organization connection layer that
// sits BEHIND the existing dispatch adapters. It answers one question: which
// channels has this org connected? A channel counts as connected when the org
// has a 'connected' gateway row for it, OR — absent any row — when the adapter
// is configured deploy-wide via the environment (the legacy fallback). An
// explicit 'revoked' row always wins, so a disconnect is honored even when an
// env var would otherwise mark the channel live.
//
// The adapter contract is untouched: dispatch still routes by ActionKind /
// channel exactly as before. This module only resolves connection state and
// brokers connect/disconnect, so it can be swapped for a real gateway (Merge,
// Zernio, …) at the marked SEAMs without churning the rest of the system.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, IntegrationConnection } from "@/lib/supabase/database.types";
import { envConfiguredChannels } from "./catalog";

// The unified gateway brokering connections. One value today; kept explicit so a
// future native/OAuth path can coexist per row.
export const GATEWAY_PROVIDER = "merge";

export type ConnectionRow = Pick<IntegrationConnection, "channel" | "status">;

// Pure resolution: fold the org's gateway rows over the env-configured fallback.
// A row for a channel is authoritative (connected/revoked); a channel with no
// row inherits the env default.
export function resolveConnectedChannels(
  rows: ConnectionRow[],
  envChannels: Set<string> = envConfiguredChannels(),
): Set<string> {
  const connected = new Set<string>(envChannels);
  for (const row of rows) {
    if (row.status === "connected") connected.add(row.channel);
    else connected.delete(row.channel);
  }
  return connected;
}

// Read the org's connection rows. Best-effort: a read failure (or a deploy
// without the table yet) degrades to the env-only fallback rather than throwing,
// so the composer and settings still render.
export async function loadOrgConnections(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<IntegrationConnection[]> {
  const { data, error } = await supabase
    .from("integration_connections")
    .select("*")
    .eq("organization_id", orgId);
  if (error || !data) return [];
  return data;
}

// The set of channels this org has live, gateway rows folded over env fallback.
export async function orgConnectedChannels(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<Set<string>> {
  const rows = await loadOrgConnections(supabase, orgId);
  return resolveConnectedChannels(rows);
}

// SEAM: a real gateway returns the connected account's handle from its hosted
// auth (Merge Link / Zernio connect) token exchange. Until that lands we mint a
// deterministic, obviously-local handle so the connection is recognizable in the
// UI without implying a real external account.
export function mockAccountLabel(channel: string): string {
  return `${channel}@connected.local`;
}
