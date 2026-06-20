"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { encryptSecret, vaultConfigured } from "@/lib/vault";

// Third-party secret vault. The operator pastes a provider credential; we
// encrypt it at rest and persist via the RLS-enforced client (writer-write
// policy is the gate). One row per (org, provider): re-saving overwrites.

/** Store (or replace) a third-party secret for the org. */
export async function saveSecret(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  if (!vaultConfigured()) {
    return { error: "Secret vault is unavailable — FUNDEXECS_VAULT_KEY is not set" };
  }

  const provider = String(formData.get("provider") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  if (!provider) return { error: "Provider is required" };
  if (!value) return { error: "Secret value is required" };

  let encrypted: ReturnType<typeof encryptSecret>;
  try {
    encrypted = encryptSecret(value);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Encryption failed" };
  }

  const supabase = createServerClient();
  const { error } = await supabase.from("org_secrets").upsert(
    {
      organization_id: ctx.orgId,
      provider,
      label: label || null,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      last4: value.slice(-4),
      created_by: ctx.userId,
    },
    { onConflict: "organization_id,provider" },
  );

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}

/** Remove a stored third-party secret. */
export async function deleteSecret(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing secret id" };

  const supabase = createServerClient();
  const { error } = await supabase
    .from("org_secrets")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}
