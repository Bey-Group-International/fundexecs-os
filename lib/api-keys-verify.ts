// Server-only verification path for issued API keys. Kept separate from
// api-keys.ts because it imports the service-role Supabase client (which pulls
// in next/headers) — importing that into a client component breaks the build.
// Client-safe helpers (hashing, masking) live in api-keys.ts; this file is only
// ever reached from route handlers.
import { createServiceClient } from "@/lib/supabase/server";
import {
  hashSecret,
  looksLikeSecretKey,
  extractApiKey,
  type VerifiedKey,
} from "@/lib/api-keys";

/**
 * Resolve a presented secret key to its org, or null if it is malformed,
 * unknown, or revoked. Uses the service-role client (the caller is an external
 * API consumer with no Supabase session) and best-effort stamps last_used_at.
 * Returns null — never throws — when the service role is unconfigured, so the
 * route layer can map the absence cleanly.
 */
export async function verifyApiKey(
  secret: string | null | undefined,
): Promise<VerifiedKey | null> {
  if (!secret || !looksLikeSecretKey(secret)) return null;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("api_keys")
    .select("id, organization_id, mode, scopes")
    .eq("secret_hash", hashSecret(secret))
    .is("revoked_at", null)
    .maybeSingle();

  if (!data) return null;

  // Best-effort usage stamp — never block verification on the write.
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    keyId: data.id,
    orgId: data.organization_id,
    mode: data.mode,
    scopes: Array.isArray(data.scopes) ? data.scopes : [],
  };
}

/**
 * Gate an inbound API route on a valid secret key. Mirrors requireOrgContext's
 * tagged-result shape so handlers can map the reason to an HTTP status.
 */
export async function requireApiKey(
  request: Request,
): Promise<
  | { ok: true; key: VerifiedKey }
  | { ok: false; status: 401 | 503; error: string }
> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      status: 503,
      error: "API key verification is unavailable (service role not configured)",
    };
  }
  const key = await verifyApiKey(extractApiKey(request));
  if (!key) return { ok: false, status: 401, error: "Invalid or missing API key" };
  return { ok: true, key };
}
