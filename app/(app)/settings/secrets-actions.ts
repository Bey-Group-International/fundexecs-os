"use server";

// Writer for the org secret vault (org_secrets, migration 0044) — until now
// the vault had NO writer anywhere in the app, so getOrgSecret always
// returned null and every external channel fell through to the deploy-wide
// env credential (single-tenant on every channel). Keys are restricted to
// the provider credentials the dispatch layer actually resolves
// (lib/integrations/credentials.ts), so the vault can't become a dumping
// ground for arbitrary key/value pairs.
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { encryptSecret, vaultConfigured } from "@/lib/vault";
import { ALL_SECRET_KEYS } from "@/lib/integrations/credentials";

export interface OrgSecretResult {
  ok: boolean;
  error?: string;
}

export interface OrgSecretMeta {
  provider: string;
  last4: string;
  updatedAt: string | null;
}

function isAllowedKey(key: string): boolean {
  return ALL_SECRET_KEYS.includes(key);
}

/** Store (or rotate) one provider credential for the org. */
export async function setOrgSecret(formData: FormData): Promise<OrgSecretResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  if (!vaultConfigured()) {
    return { ok: false, error: "The secret vault is not configured on this deployment (FUNDEXECS_VAULT_KEY)." };
  }

  const provider = String(formData.get("provider") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  if (!isAllowedKey(provider)) return { ok: false, error: "Unknown credential key." };
  if (!value) return { ok: false, error: "Enter a credential value." };

  const encrypted = encryptSecret(value);
  const supabase = createServerClient();
  const { error } = await supabase.from("org_secrets").upsert(
    {
      organization_id: ctx.orgId,
      provider,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      last4: value.slice(-4),
      created_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,provider" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

/** Remove one provider credential — dispatch falls back to the deploy env var. */
export async function deleteOrgSecret(formData: FormData): Promise<OrgSecretResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authorized." };
  const provider = String(formData.get("provider") ?? "").trim();
  if (!isAllowedKey(provider)) return { ok: false, error: "Unknown credential key." };

  const supabase = createServerClient();
  const { error } = await supabase
    .from("org_secrets")
    .delete()
    .eq("organization_id", ctx.orgId)
    .eq("provider", provider);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

/** Masked metadata for the org's stored credentials — never the plaintext. */
export async function listOrgSecrets(): Promise<OrgSecretMeta[]> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];
  const supabase = createServerClient();
  const { data } = await supabase
    .from("org_secrets")
    .select("provider, last4, updated_at")
    .eq("organization_id", ctx.orgId)
    .in("provider", [...ALL_SECRET_KEYS]);
  return (data ?? []).map((row) => ({
    provider: row.provider,
    last4: row.last4,
    updatedAt: row.updated_at ?? null,
  }));
}
