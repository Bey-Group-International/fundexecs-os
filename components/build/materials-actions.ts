"use server";

// Sharing, not authoring. This file governs who can see a data room: link
// creation with its gates, password verification, alerts, and revocation.
// Reading time is recorded by the viewer (components/dataroom/viewer-actions.ts).
// Documents themselves are created and edited in the library
// (components/documents/document-actions.ts) and reach a room only through the
// explicit publish manifest (components/build/room-actions.ts).
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { insertShare } from "@/lib/data-room-shares.server";

const ROOM = "/build/data_room";

// --- Shareable data-room links --------------------------------------------

async function comparePassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith("pbkdf2:")) {
    // Legacy sha256 hashes: reject and require re-auth with new hash.
    return false;
  }
  const [, salt, expectedHash] = stored.split(":");
  const { pbkdf2Sync } = await import("crypto");
  const actualHash = pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
  return actualHash === expectedHash;
}

// Create a link into one room. A link is always scoped to a room: there is no
// "share everything" link, because the library holds drafts and internal-only
// material that must never be reachable from a token.
export async function createShare(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const roomId = String(formData.get("room_id") ?? "").trim();
  if (!roomId) return;
  const days = Number(String(formData.get("expires_in_days") ?? "").trim());

  // Selective sections: serialized as JSON array from the form, or null = full room.
  const sectionsRaw = String(formData.get("allowed_sections") ?? "").trim();
  let allowedSections: string[] | null = null;
  if (sectionsRaw) {
    try {
      const parsed = JSON.parse(sectionsRaw);
      if (Array.isArray(parsed) && parsed.length > 0) allowedSections = parsed.map(String);
    } catch {
      // ignore malformed input
    }
  }

  const supabase = await createServerClient();
  // Re-check the room against the caller's org so a stray id can't mint a link
  // into another firm's room.
  const { data: room } = await supabase
    .from("data_rooms")
    .select("id")
    .eq("id", roomId)
    .eq("organization_id", ctx.orgId)
    .is("archived_at", null)
    .maybeSingle();
  if (!room) return;

  await insertShare(supabase, {
    orgId: ctx.orgId,
    userId: ctx.userId,
    roomId,
    label: String(formData.get("label") ?? "").trim() || null,
    expiresInDays: Number.isFinite(days) && days > 0 ? days : null,
    requireEmail: formData.get("require_email") === "1",
    requireNda: formData.get("require_nda") === "1",
    ndaText: String(formData.get("nda_text") ?? "").trim() || null,
    password: String(formData.get("password") ?? "").trim() || null,
    recipientEmail: String(formData.get("recipient_email") ?? "").trim() || null,
    notifyOnOpen: formData.get("notify_on_open") === "1",
    dailyDigest: formData.get("daily_digest") === "1",
    allowedSections,
    // Unchecked boxes are absent from FormData, so "allow download" is sent as
    // an explicit "0" when turned off; anything else keeps the old default.
    allowDownload: formData.get("allow_download") !== "0",
    watermark: formData.get("watermark") === "1",
  });

  revalidatePath(ROOM);
}

/** Verify a data-room password from the public viewer (no auth required). On
 * success, grants the "pwd" gate for this share via a signed server-side pass
 * — the page itself now withholds content until this (and any other
 * configured gate) is granted, rather than trusting a client-side flag. */
export async function verifySharePassword(token: string, password: string): Promise<boolean> {
  const { createServiceClient, hasSupabaseServiceEnv } = await import("@/lib/supabase/server");
  if (!hasSupabaseServiceEnv()) return false;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("data_room_shares")
    .select("id, password_hash, revoked_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data?.password_hash) return false;
  if (data.revoked_at) return false;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return false;
  const ok = await comparePassword(password, data.password_hash);
  if (!ok) return false;
  const { grantGate } = await import("@/lib/data-room-gate");
  await grantGate(data.id as string, { pwd: true });
  return true;
}

/**
 * Turn a live link's alerts on or off: the first-open email per reader and the
 * daily activity digest. Alerts are about the operator's inbox, not about what
 * the reader sees, so they can change on a link already in someone's hands.
 */
export async function updateShareAlerts(
  id: string,
  alerts: { notifyOnOpen?: boolean; dailyDigest?: boolean },
): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId || typeof id !== "string" || !id) return;
  const patch: { notify_on_open?: boolean; daily_digest?: boolean } = {};
  if (typeof alerts?.notifyOnOpen === "boolean") patch.notify_on_open = alerts.notifyOnOpen;
  if (typeof alerts?.dailyDigest === "boolean") patch.daily_digest = alerts.dailyDigest;
  if (Object.keys(patch).length === 0) return;
  const supabase = await createServerClient();
  await supabase
    .from("data_room_shares")
    .update(patch as never)
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(ROOM);
}

export async function revokeShare(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createServerClient();
  await supabase
    .from("data_room_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(ROOM);
}
