// lib/identity.ts
// Trust layer: internal identity verification for principals.
//
// The compounding loop (lib/engine.ts verifyArtifact) couples earned
// reputation to a verified identity: an operator approval only MINTS standing
// when the verifying principal is itself identity-verified. This module is the
// read side of that gate (isPrincipalIdentityVerified) plus the write side — an
// owner/admin internal attestation (attestPrincipalIdentity).
//
// "Internal attestation now, external-KYC provider hook later": today an
// owner/admin attests a teammate's identity. When an external KYC/identity
// provider is integrated, its verified result replaces the internal attestation
// at the PROVIDER HOOK below — it sets the SAME columns, so nothing downstream
// changes. The coupling is SOFT: verification is never blocked on identity; only
// the reputation grant is withheld until someone is marked verified.
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import type { Principal } from "@/lib/supabase/database.types";

type Client = ReturnType<typeof createServerClient>;

/**
 * Pure predicate: is this principal row identity-verified? True iff it carries a
 * non-null identity_verified_at. Kept pure (no I/O) so the gate's meaning is unit
 * testable and the async reader below stays a thin DB wrapper.
 */
export function isVerifiedPrincipalRow(
  row: Pick<Principal, "identity_verified_at"> | null | undefined,
): boolean {
  return Boolean(row && row.identity_verified_at != null);
}

/**
 * True iff principal `principalId` has a non-null identity_verified_at. Defensive
 * by design: any error (or missing row) yields `false` so the caller simply skips
 * the reputation grant rather than throwing — the coupling must never break the
 * verification flow it sits beside.
 */
export async function isPrincipalIdentityVerified(
  supabase: Client,
  principalId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("principals")
      .select("identity_verified_at")
      .eq("id", principalId)
      .maybeSingle();
    if (error) return false;
    return isVerifiedPrincipalRow(data);
  } catch {
    return false;
  }
}

/**
 * Owner/admin internal attestation: mark a principal identity-verified, stamping
 * who attested and when. Mirrors the settings server-action auth/guard pattern
 * (getSessionContext → org + role check; RLS is the backstop). Non-admins get a
 * typed error; the gate is intentionally simple because this is internal-only.
 */
export async function attestPrincipalIdentity(
  principalId: string,
): Promise<{ error?: string }> {
  "use server";
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return { error: "Only an owner or admin can attest identity" };
  }
  if (!principalId) return { error: "principalId is required" };

  const supabase = createServerClient();

  // PROVIDER HOOK: today this is a trusted internal attestation by an owner/admin.
  // When an external KYC/identity provider is wired up, replace the assignment
  // below with the provider's verified result — set identity_verified_at from the
  // provider's verification timestamp and record the provider/reference in
  // identity_verified_by (or a future provider-ref column). The read gate
  // (isPrincipalIdentityVerified) and the reputation coupling stay unchanged.
  const { error } = await supabase
    .from("principals")
    .update({
      identity_verified_at: new Date().toISOString(),
      identity_verified_by: ctx.userId,
    })
    .eq("id", principalId);

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}
