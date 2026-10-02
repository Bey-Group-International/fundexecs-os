"use server";

import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Records an NDA signature in nda_signatures.
 * Uses the service client so the insert bypasses RLS
 * (the table has no authenticated-role insert policy by design).
 *
 * On success, grants the "nda" gate for this share via a signed server-side
 * pass — the page withholds content until every configured gate is granted.
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
  // on the signature for efficient RLS-policy lookups, and reject a
  // revoked/expired share rather than recording a signature against it.
  const { data: share, error: shareErr } = await supabase
    .from("data_room_shares")
    .select("organization_id, revoked_at, expires_at")
    .eq("id", shareId)
    .single();

  if (shareErr || !share) return { ok: false };
  const shareRow = share as { organization_id: string; revoked_at: string | null; expires_at: string | null };
  if (shareRow.revoked_at) return { ok: false };
  if (shareRow.expires_at && new Date(shareRow.expires_at).getTime() < Date.now()) return { ok: false };

  const { error: insertErr } = await supabase.from("nda_signatures" as never).insert({
    share_id: shareId,
    organization_id: shareRow.organization_id,
    signer_name: signerName,
    signer_email: signerEmail,
    signed_at: signedAt,
    ip_hint: ipHint,
  } as never);

  if (insertErr) return { ok: false };

  const { grantGate } = await import("@/lib/data-room-gate");
  await grantGate(shareId, { nda: true });

  return { ok: true };
}

/**
 * Records that a visitor provided their email for a data room that requires
 * one (data capture, not authentication — there's no secret to check), then
 * grants the "email" gate for this share via a signed server-side pass.
 */
export async function passEmailGate(token: string, email: string): Promise<{ ok: boolean }> {
  const trimmed = email.trim();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { ok: false };

  const supabase = createServiceClient();
  const { data: share } = await supabase
    .from("data_room_shares")
    .select("id, revoked_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!share) return { ok: false };
  const shareRow = share as { id: string; revoked_at: string | null; expires_at: string | null };
  if (shareRow.revoked_at) return { ok: false };
  if (shareRow.expires_at && new Date(shareRow.expires_at).getTime() < Date.now()) return { ok: false };

  const { grantGate } = await import("@/lib/data-room-gate");
  await grantGate(shareRow.id, { email: trimmed });

  return { ok: true };
}

/**
 * The reader is now looking at the room's content. Records their first open
 * of this link and, the first time only, emails the link's creator when they
 * asked to be told. Called once per page view from the viewer.
 *
 * Re-checks everything the page did — the link is live and every gate this
 * reader must pass is passed — because a Server Action is a public endpoint
 * and the page's word for it is not enough.
 */
export async function recordRoomOpen(token: string, visitorId: string): Promise<void> {
  if (typeof token !== "string" || !token || typeof visitorId !== "string") return;
  const { hasSupabaseServiceEnv } = await import("@/lib/supabase/server");
  if (!hasSupabaseServiceEnv()) return;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("data_room_shares")
    .select(
      "id, organization_id, room_id, label, notify_on_open, created_by, revoked_at, expires_at, require_email, require_nda, password_hash",
    )
    .eq("token", token)
    .maybeSingle();
  const share = data as {
    id: string;
    organization_id: string;
    room_id: string | null;
    label: string | null;
    notify_on_open: boolean;
    created_by: string | null;
    revoked_at: string | null;
    expires_at: string | null;
    require_email: boolean;
    require_nda: boolean;
    password_hash: string | null;
  } | null;
  if (!share || share.revoked_at || !share.room_id) return;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return;

  const { readGatePass, gateSatisfied } = await import("@/lib/data-room-gate");
  const pass = await readGatePass(share.id);
  if (!gateSatisfied(share, pass)) return;

  const { viewerKeyFor } = await import("@/lib/data-room-alerts");
  const viewerEmail = pass?.email ?? null;
  const key = viewerKeyFor(viewerEmail, visitorId);
  if (!key) return;
  const { recordFirstOpen } = await import("@/lib/data-room-alerts.server");
  await recordFirstOpen(supabase, share, key, viewerEmail).catch(() => undefined);
}
