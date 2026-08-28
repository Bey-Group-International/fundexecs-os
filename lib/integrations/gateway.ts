// lib/integrations/gateway.ts
// The unified "merge gateway" seam — a per-organization connection layer that
// sits BEHIND the existing dispatch adapters. It answers one question: which
// channels has this org connected?
//
// A channel counts as connected when CREDENTIALS FOR IT ACTUALLY RESOLVE —
// deploy-wide env, this org's vault, or an OAuth grant somebody holds. A
// 'connected' gateway row no longer grants it.
//
// That row used to be authoritative, and the hosted-auth handshake it stands
// for has not been built: connectIntegration writes status 'connected' with a
// mockAccountLabel and performs no exchange. So pressing Connect turned a
// channel green with nothing behind it — the Settings panel reported Google
// Calendar as connected while org_secrets was empty, and dispatch would route
// to a channel it had no way to reach. A claim of connection that no
// credential backs is the same class of bug as a sync that reports success
// without contacting anyone.
//
// A row can still REVOKE. An explicit 'revoked' row always wins, so a
// disconnect is honored even when an env var would otherwise mark the channel
// live — that direction was never the lie.
//
// The adapter contract is untouched: dispatch still routes by ActionKind /
// channel exactly as before. This module only resolves connection state and
// brokers connect/disconnect, so it can be swapped for a real gateway (Merge,
// Zernio, …) at the marked SEAMs without churning the rest of the system.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, IntegrationConnection } from "@/lib/supabase/database.types";
import { envConfiguredChannels } from "./catalog";
import { CHANNEL_SECRET_KEYS } from "./credentials";

// The unified gateway brokering connections. One value today; kept explicit so a
// future native/OAuth path can coexist per row.
export const GATEWAY_PROVIDER = "merge";

export type ConnectionRow = Pick<IntegrationConnection, "channel" | "status">;

/**
 * Where a channel's credentials can legitimately come from.
 *
 * Three places, all of them real. None of them is a row in a table saying so.
 */
export interface ConnectionEvidence {
  /** Configured deploy-wide, per the adapter's own isConfigured(). */
  env: Set<string>;
  /** Present in this organization's secret vault. */
  vault: Set<string>;
  /** Backed by an OAuth grant somebody in the organization holds. */
  grants: Set<string>;
}

/**
 * Pure resolution: credentials decide, and a row can only take away.
 *
 * Note what is deliberately absent — a 'connected' row adds nothing. The
 * handshake it represents does not exist yet, so treating it as evidence is how
 * a channel with an empty vault came to show as live.
 */
export function resolveConnectedChannels(
  rows: ConnectionRow[],
  evidence: ConnectionEvidence,
): Set<string> {
  const connected = new Set<string>([...evidence.env, ...evidence.vault, ...evidence.grants]);
  for (const row of rows) {
    if (row.status === "revoked") connected.delete(row.channel);
  }
  return connected;
}

/** Evidence with only the deploy-wide half filled in, for callers with no org. */
export function envOnlyEvidence(
  env: Set<string> = envConfiguredChannels(),
): ConnectionEvidence {
  return { env, vault: new Set(), grants: new Set() };
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

/**
 * The channels this org can actually reach, from credentials rather than claims.
 *
 * Reads the evidence directly: which vault keys exist, and whether anybody has
 * an OAuth grant. Best-effort throughout — a failed read degrades that one
 * source to "no evidence" rather than throwing, because the panel and the
 * composer must still render, and reporting a channel as unconnected is the
 * safe direction to be wrong in.
 */
export async function orgConnectedChannels(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<Set<string>> {
  const [rows, vault, grants] = await Promise.all([
    loadOrgConnections(supabase, orgId),
    vaultBackedChannels(supabase, orgId),
    grantBackedChannels(supabase, orgId),
  ]);
  return resolveConnectedChannels(rows, { env: envConfiguredChannels(), vault, grants });
}

/**
 * Channels with at least one credential stored in this org's vault.
 *
 * One query rather than a decrypt per key: presence of the row is what makes a
 * channel reachable, and a value that fails to decrypt is a broken credential
 * rather than an absent one — which the send path reports far better than a
 * connection panel can.
 */
export async function vaultBackedChannels(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  const { data, error } = await supabase
    .from("org_secrets")
    .select("provider")
    .eq("organization_id", orgId);
  if (error || !data) return out;

  const stored = new Set((data as { provider: string }[]).map((r) => r.provider));
  for (const [channel, keys] of Object.entries(CHANNEL_SECRET_KEYS)) {
    if (keys.some((k) => stored.has(k))) out.add(channel);
  }
  return out;
}

/**
 * Channels backed by an OAuth grant somebody in the organization holds.
 *
 * google_calendar is per-member rather than per-org, so one member's grant is
 * what makes the channel reachable at all — which is the question this answers.
 */
export async function grantBackedChannels(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  const { data, error } = await supabase
    .from("google_calendar_connections")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1);
  if (!error && data && data.length > 0) out.add("google_calendar");
  return out;
}

// SEAM: a real gateway returns the connected account's handle from its hosted
// auth (Merge Link / Zernio connect) token exchange. Until that lands we mint a
// deterministic, obviously-local handle so the connection is recognizable in the
// UI without implying a real external account.
export function mockAccountLabel(channel: string): string {
  return `${channel}@connected.local`;
}
