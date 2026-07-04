"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import {
  generateKeyPair,
  hashSecret,
  secretPrefix,
  secretLast4,
  API_KEY_MODES,
  DEFAULT_API_SCOPES,
  isApiScope,
} from "@/lib/api-keys";
import type { ApiKeyMode } from "@/lib/supabase/database.types";

// FundExecs-issued API credentials. Writes go through the RLS-enforced server
// client (so the writer-write policy is the real gate); the secret key is
// returned to the caller exactly once and only its hash is ever stored.

function parseMode(value: FormDataEntryValue | null): ApiKeyMode {
  const v = String(value ?? "test");
  return (API_KEY_MODES as readonly string[]).includes(v) ? (v as ApiKeyMode) : "test";
}

/**
 * Mint a new key pair for the org. Returns the freshly generated secret key so
 * the UI can show it once — it is never retrievable again.
 */
export async function createApiKey(
  formData: FormData,
): Promise<{ error?: string; publishableKey?: string; secretKey?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required" };
  const mode = parseMode(formData.get("mode"));

  // Scope selection (checkbox group). No selection = the read set (NOT the
  // full catalog — write scopes are opt-in), so a form that doesn't render the
  // picker issues keys exactly as before; anything outside the catalog is
  // rejected rather than silently dropped.
  const requested = formData.getAll("scopes").map(String);
  if (requested.some((s) => !isApiScope(s))) return { error: "Unknown scope requested" };
  const scopes = requested.length > 0 ? requested : [...DEFAULT_API_SCOPES];

  const { publishableKey, secretKey } = generateKeyPair(mode);

  const supabase = await createServerClient();
  const { error } = await supabase.from("api_keys").insert({
    organization_id: ctx.orgId,
    name,
    mode,
    scopes,
    publishable_key: publishableKey,
    secret_hash: hashSecret(secretKey),
    secret_prefix: secretPrefix(secretKey),
    secret_last4: secretLast4(secretKey),
    created_by: ctx.userId,
  });

  if (error) return { error: error.message };
  revalidatePath("/settings");
  // Secret returned once, then discarded by the client.
  return { publishableKey, secretKey };
}

/** Permanently revoke a key — verification stops resolving it immediately. */
export async function revokeApiKey(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing key id" };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .is("revoked_at", null);

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}

/**
 * Rotate a key's secret in place: the publishable key and id are kept (so any
 * stored reference to the key survives), a new secret is minted in the same
 * mode, and the old secret stops working at once. Returns the new secret to
 * show once.
 */
export async function rotateApiKey(
  formData: FormData,
): Promise<{ error?: string; secretKey?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing key id" };

  const supabase = await createServerClient();
  const { data: existing, error: readError } = await supabase
    .from("api_keys")
    .select("mode, revoked_at")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();

  if (readError) return { error: readError.message };
  if (!existing) return { error: "Key not found" };
  if (existing.revoked_at) return { error: "Cannot rotate a revoked key" };

  const { secretKey } = generateKeyPair(existing.mode as ApiKeyMode);
  const { error } = await supabase
    .from("api_keys")
    .update({
      secret_hash: hashSecret(secretKey),
      secret_prefix: secretPrefix(secretKey),
      secret_last4: secretLast4(secretKey),
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { secretKey };
}
