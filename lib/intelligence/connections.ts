// lib/intelligence/connections.ts
// Provider-connection persistence + secret resolution. Server-only.
//
// A ProviderConnection is the ONLY place a provider is configured for a
// workspace. The API token is stored encrypted with the SAME AES-256-GCM vault
// envelope as org_secrets / mcp_servers (lib/vault.ts) — ciphertext + iv +
// auth_tag + a masked last-4. The plaintext is decrypted in memory only, on the
// server, for the duration of a call, and NEVER returned to the browser.
//
// The table is new, so (like lib/proactive/items.ts and lib/source-cache.ts) we
// reach it through a narrow unknown-cast until the generated DB types are
// regenerated. All reads/writes are explicitly org-scoped.

import type { createServiceClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret, vaultConfigured } from "@/lib/vault";
import type { ProviderConnection } from "./types";

type Db = ReturnType<typeof createServiceClient>;

const TABLE = "intelligence_provider_connections";

function tbl(supabase: Db) {
  return (supabase as unknown as { from: (t: string) => ReturnType<Db["from"]> }).from(TABLE);
}

interface Row {
  id: string;
  organization_id: string;
  provider: string;
  label: string | null;
  status: string;
  auth_mode: string;
  config: Record<string, unknown> | null;
  feature_permissions: Record<string, boolean> | null;
  rate_limits: Record<string, number> | null;
  health: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  token_ciphertext: string | null;
  token_iv: string | null;
  token_auth_tag: string | null;
  token_last4: string | null;
}

function rowToConnection(r: Row): ProviderConnection {
  return {
    id: r.id,
    workspaceId: r.organization_id,
    provider: r.provider,
    label: r.label,
    status: r.status as ProviderConnection["status"],
    authMode: r.auth_mode as ProviderConnection["authMode"],
    config: r.config ?? {},
    featurePermissions: r.feature_permissions ?? {},
    rateLimits: r.rate_limits ?? {},
    health: r.health as ProviderConnection["health"],
    lastSuccessAt: r.last_success_at,
    lastFailureAt: r.last_failure_at,
    lastError: r.last_error,
  };
}

/** Fetch the connection metadata for a workspace + provider (no secret). */
export async function getConnection(
  supabase: Db,
  workspaceId: string,
  provider: string,
): Promise<ProviderConnection | null> {
  const { data, error } = await tbl(supabase)
    .select("*")
    .eq("organization_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (error || !data) return null;
  return rowToConnection(data as unknown as Row);
}

/**
 * Resolve the decrypted token for a connected provider. Returns null when the
 * connection is missing, not 'connected', the vault key is unset, or no token is
 * stored. Server-only; the plaintext never leaves this process.
 */
export async function resolveToken(
  supabase: Db,
  workspaceId: string,
  provider: string,
): Promise<string | null> {
  if (!vaultConfigured()) return null;
  const { data, error } = await tbl(supabase)
    .select("status,token_ciphertext,token_iv,token_auth_tag")
    .eq("organization_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as unknown as Pick<Row, "status" | "token_ciphertext" | "token_iv" | "token_auth_tag">;
  if (r.status !== "connected") return null;
  if (!r.token_ciphertext || !r.token_iv || !r.token_auth_tag) return null;
  try {
    return decryptSecret({ ciphertext: r.token_ciphertext, iv: r.token_iv, authTag: r.token_auth_tag });
  } catch {
    return null; // tampered / wrong key — treat as no token.
  }
}

/** Upsert a connection's config + (optionally) a freshly-encrypted token. */
export async function saveConnection(
  supabase: Db,
  input: {
    workspaceId: string;
    provider: string;
    label?: string | null;
    status?: ProviderConnection["status"];
    authMode?: ProviderConnection["authMode"];
    config?: Record<string, unknown>;
    featurePermissions?: Record<string, boolean>;
    rateLimits?: Record<string, number>;
    /** Plaintext token; encrypted here. Omit to leave the stored token as-is. */
    token?: string | null;
    createdBy?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const patch: Record<string, unknown> = {
    organization_id: input.workspaceId,
    provider: input.provider,
  };
  if (input.label !== undefined) patch.label = input.label;
  if (input.status !== undefined) patch.status = input.status;
  if (input.authMode !== undefined) patch.auth_mode = input.authMode;
  if (input.config !== undefined) patch.config = input.config;
  if (input.featurePermissions !== undefined) patch.feature_permissions = input.featurePermissions;
  if (input.rateLimits !== undefined) patch.rate_limits = input.rateLimits;
  if (input.createdBy !== undefined) patch.created_by = input.createdBy;

  if (input.token !== undefined) {
    if (input.token === null) {
      patch.token_ciphertext = null;
      patch.token_iv = null;
      patch.token_auth_tag = null;
      patch.token_last4 = null;
    } else {
      if (!vaultConfigured()) return { ok: false, error: "FUNDEXECS_VAULT_KEY is not configured" };
      const enc = encryptSecret(input.token);
      patch.token_ciphertext = enc.ciphertext;
      patch.token_iv = enc.iv;
      patch.token_auth_tag = enc.authTag;
      patch.token_last4 = input.token.slice(-4);
    }
  }

  const { error } = await tbl(supabase).upsert(patch, { onConflict: "organization_id,provider" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Record the outcome of a sync attempt on the connection (health bookkeeping). */
export async function recordSyncOutcome(
  supabase: Db,
  workspaceId: string,
  provider: string,
  outcome: { ok: boolean; error?: string; at?: string },
): Promise<void> {
  const at = outcome.at ?? new Date().toISOString();
  const patch: Record<string, unknown> = outcome.ok
    ? { health: "healthy", last_success_at: at, last_error: null, status: "connected" }
    : { health: "degraded", last_failure_at: at, last_error: outcome.error ?? "sync failed" };
  await tbl(supabase)
    .update(patch)
    .eq("organization_id", workspaceId)
    .eq("provider", provider);
}
