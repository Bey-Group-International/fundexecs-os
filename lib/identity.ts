// lib/identity.ts
// Trust layer: internal identity verification for principals.
//
// The compounding loop (lib/engine.ts verifyArtifact) couples earned
// reputation to a verified identity: an operator approval only MINTS standing
// when the verifying principal is itself identity-verified. This module is the
// read side of that gate (isPrincipalIdentityVerified).
//
// The coupling is SOFT: verification is never blocked on identity; only the
// reputation grant is withheld until someone is marked verified.
import { createServerClient } from "@/lib/supabase/server";
import type { Principal } from "@/lib/supabase/database.types";

type Client = Awaited<ReturnType<typeof createServerClient>>;

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
