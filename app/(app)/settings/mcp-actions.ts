"use server";

// CRUD for the custom MCP-server registry (mcp_servers, migration
// 20260714120000). A registry only: these actions persist connection details
// for a remote (HTTP / SSE) MCP server so an org can manage them in Settings.
// Nothing here connects to the server or runs its tools.
//
// The optional bearer token is encrypted with the same AES-256-GCM vault as
// org_secrets (lib/vault.ts) — the plaintext is never stored and never returned
// to the client; the panel only ever sees a masked last-4.
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext, type SessionContext } from "@/lib/auth";
import { encryptSecret, vaultConfigured } from "@/lib/vault";
import { normalizeMcpServerInput, type McpTransport } from "@/lib/mcp/registry";

export interface McpActionResult {
  ok: boolean;
  error?: string;
}

// Masked view of a registered server — safe to send to the client. Never
// includes the ciphertext/iv/auth_tag, only whether a token exists and its
// last-4.
export interface McpServerView {
  id: string;
  name: string;
  transport: McpTransport;
  url: string;
  authHeader: string;
  hasToken: boolean;
  tokenLast4: string | null;
  enabled: boolean;
  updatedAt: string | null;
}

// A registered MCP server can carry a credential (its bearer token) and lets the
// org reach an external service, so writes are held to the same admin bar as
// provider credentials (secrets-actions.ts) and membership changes.
function canManage(ctx: SessionContext | null): ctx is SessionContext & { orgId: string } {
  return Boolean(ctx?.orgId) && (ctx?.role === "owner" || ctx?.role === "admin");
}

/** Masked list of the org's registered MCP servers, newest first. */
export async function listMcpServers(): Promise<McpServerView[]> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("mcp_servers")
    .select("id, name, transport, url, auth_header, token_last4, enabled, updated_at")
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    transport: row.transport,
    url: row.url,
    authHeader: row.auth_header,
    hasToken: Boolean(row.token_last4),
    tokenLast4: row.token_last4,
    enabled: row.enabled,
    updatedAt: row.updated_at ?? null,
  }));
}

/**
 * Create a new MCP server or update an existing one (when `id` is present).
 *
 * Token handling:
 * - A supplied token is encrypted into the vault and stored; requires the vault
 *   to be configured on this deployment.
 * - On update, a blank token leaves the stored token untouched (the common
 *   "edit the URL, keep the credential" case). Submitting `clear_token=1` nulls
 *   it so the server becomes unauthenticated.
 * - On create, a blank token simply registers an unauthenticated server.
 */
export async function saveMcpServer(formData: FormData): Promise<McpActionResult> {
  const ctx = await getSessionContext();
  if (!canManage(ctx)) {
    return { ok: false, error: "Only organization owners and admins can manage MCP servers." };
  }

  const normalized = normalizeMcpServerInput({
    name: formData.get("name"),
    transport: formData.get("transport"),
    url: formData.get("url"),
    authHeader: formData.get("auth_header"),
  });
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const { name, transport, url, authHeader } = normalized.value;

  const id = String(formData.get("id") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  const clearToken = String(formData.get("clear_token") ?? "") === "1";

  // Base fields common to create and update.
  const base = { name, transport, url, auth_header: authHeader };

  // Resolve the token columns to write, if any. `undefined` means "don't touch"
  // (update only); an object means "set"; the cleared/absent-on-create cases
  // null them out.
  let tokenCols:
    | { token_ciphertext: string | null; token_iv: string | null; token_auth_tag: string | null; token_last4: string | null }
    | undefined;

  if (token) {
    if (!vaultConfigured()) {
      return {
        ok: false,
        error: "The secret vault is not configured on this deployment (FUNDEXECS_VAULT_KEY).",
      };
    }
    const enc = encryptSecret(token);
    tokenCols = {
      token_ciphertext: enc.ciphertext,
      token_iv: enc.iv,
      token_auth_tag: enc.authTag,
      token_last4: token.slice(-4),
    };
  } else if (clearToken || !id) {
    // Explicit clear, or a create with no token → unauthenticated server.
    tokenCols = { token_ciphertext: null, token_iv: null, token_auth_tag: null, token_last4: null };
  }

  const supabase = await createServerClient();

  if (id) {
    const { error } = await supabase
      .from("mcp_servers")
      .update({ ...base, ...(tokenCols ?? {}) })
      .eq("id", id)
      .eq("organization_id", ctx.orgId);
    if (error) return { ok: false, error: friendly(error.message) };
  } else {
    const { error } = await supabase.from("mcp_servers").insert({
      organization_id: ctx.orgId,
      ...base,
      ...(tokenCols ?? {}),
      enabled: true,
      created_by: ctx.userId,
    });
    if (error) return { ok: false, error: friendly(error.message) };
  }

  revalidatePath("/settings");
  return { ok: true };
}

/** Enable or disable a registered server without deleting it. */
export async function toggleMcpServer(formData: FormData): Promise<McpActionResult> {
  const ctx = await getSessionContext();
  if (!canManage(ctx)) {
    return { ok: false, error: "Only organization owners and admins can manage MCP servers." };
  }
  const id = String(formData.get("id") ?? "").trim();
  const enabled = String(formData.get("enabled") ?? "") === "1";
  if (!id) return { ok: false, error: "Missing server id." };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("mcp_servers")
    .update({ enabled })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

/** Remove a registered server entirely. */
export async function deleteMcpServer(formData: FormData): Promise<McpActionResult> {
  const ctx = await getSessionContext();
  if (!canManage(ctx)) {
    return { ok: false, error: "Only organization owners and admins can manage MCP servers." };
  }
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing server id." };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("mcp_servers")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

// The unique (organization_id, name) constraint surfaces as a Postgres 23505;
// translate it into something an operator can act on.
function friendly(message: string): string {
  if (/duplicate key|unique|23505/i.test(message)) {
    return "A server with that name already exists — pick a different name.";
  }
  return message;
}
