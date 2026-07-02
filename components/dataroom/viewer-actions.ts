"use server";

import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Records an NDA signature in nda_signatures.
 * Uses the service client so the insert bypasses RLS
 * (the table has no authenticated-role insert policy by design).
 */
export async function recordNdaSignature(formData: FormData): Promise<{ ok: boolean }> {
  const shareId = String(formData.get("share_id") ?? "").trim();
  const signerName = String(formData.get("signer_name") ?? "").trim();
  const signerEmail = String(formData.get("signer_email") ?? "").trim() || null;
  const signedAt = String(formData.get("signed_at") ?? "").trim();

  if (!shareId || !signerName || !signedAt) return { ok: false };

  // Derive IP hint (first 3 octets) for lightweight audit trail.
  // We never store the full IP to minimise PII exposure.
  let ipHint: string | null = null;
  try {
    const headersList = await headers();
    const rawIp =
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      headersList.get("x-real-ip") ??
      null;
    if (rawIp) {
      const parts = rawIp.split(".");
      if (parts.length === 4) {
        // IPv4 — keep first 3 octets
        ipHint = parts.slice(0, 3).join(".");
      } else {
        // IPv6 — keep first 3 groups
        const v6parts = rawIp.split(":");
        ipHint = v6parts.slice(0, 3).join(":");
      }
    }
  } catch {
    // headers() unavailable in some edge environments — skip
  }

  const supabase = createServiceClient();

  // Resolve the organization_id from the share row so we can store it
  // on the signature for efficient RLS-policy lookups.
  const { data: share, error: shareErr } = await supabase
    .from("data_room_shares")
    .select("organization_id")
    .eq("id", shareId)
    .single();

  if (shareErr || !share) return { ok: false };

  const { error: insertErr } = await supabase.from("nda_signatures" as never).insert({
    share_id: shareId,
    organization_id: (share as { organization_id: string }).organization_id,
    signer_name: signerName,
    signer_email: signerEmail,
    signed_at: signedAt,
    ip_hint: ipHint,
  } as never);

  return { ok: !insertErr };
}
