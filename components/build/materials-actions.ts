"use server";

// Sharing, not authoring. This file governs who can see a data room: link
// creation with its gates, password verification, dwell tracking, and
// revocation. Documents themselves are created and edited in the library
// (components/documents/document-actions.ts) and reach a room only through the
// explicit publish manifest (components/build/room-actions.ts).
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { sendEmail, shareGrantedEmail, escapeHtml } from "@/lib/email";

const ROOM = "/build/data_room";

// --- Shareable data-room links --------------------------------------------

async function hashPassword(password: string): Promise<string> {
  const { pbkdf2Sync, randomBytes } = await import("crypto");
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
  return `pbkdf2:${salt}:${hash}`;
}

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
  const label = String(formData.get("label") ?? "").trim() || null;
  const days = Number(String(formData.get("expires_in_days") ?? "").trim());
  const expires_at =
    Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;

  const requireEmail = formData.get("require_email") === "1";
  const requireNda = formData.get("require_nda") === "1";
  const ndaText = String(formData.get("nda_text") ?? "").trim() || null;
  const passwordRaw = String(formData.get("password") ?? "").trim();
  const password_hash = passwordRaw ? await hashPassword(passwordRaw) : null;
  const recipientEmail = String(formData.get("recipient_email") ?? "").trim() || null;
  const notifyOnOpen = formData.get("notify_on_open") === "1";

  // Selective sections: serialized as JSON array from the form, or null = full room.
  const sectionsRaw = String(formData.get("allowed_sections") ?? "").trim();
  let allowed_sections: string[] | null = null;
  if (sectionsRaw) {
    try {
      const parsed = JSON.parse(sectionsRaw);
      if (Array.isArray(parsed) && parsed.length > 0) allowed_sections = parsed.map(String);
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

  const { data: inserted } = await supabase
    .from("data_room_shares")
    .insert({
      organization_id: ctx.orgId,
      room_id: roomId,
      label,
      expires_at,
      created_by: ctx.userId,
      require_email: requireEmail,
      require_nda: requireNda,
      nda_text: ndaText,
      password_hash,
      recipient_email: recipientEmail,
      notify_on_open: notifyOnOpen,
      allowed_sections,
    } as never)
    .select("token")
    .maybeSingle();

  revalidatePath(ROOM);

  // Send share-granted email to the recipient if provided.
  if (recipientEmail && inserted) {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", ctx.orgId)
      .maybeSingle();
    if (orgRow) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.fundexecs.com";
      const shareUrl = `${baseUrl}/dataroom/${(inserted as { token: string }).token}`;
      const { subject, html } = shareGrantedEmail(orgRow.name as string, label, shareUrl, expires_at);
      void sendEmail({ orgId: ctx.orgId, to: { name: "", email: recipientEmail }, subject, htmlBody: html }).catch(
        () => undefined,
      );
    }
  }
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
 * Record section dwell time from the public data-room viewer.
 * Uses the service role because the data_room_views table has no anon insert policy.
 */
export async function trackDwell(formData: FormData): Promise<void> {
  const shareId = String(formData.get("share_id") ?? "").trim();
  const documentId = String(formData.get("document_id") ?? "").trim() || null;
  const durationSeconds = parseInt(String(formData.get("duration_seconds") ?? "0"), 10);
  const viewerEmail = String(formData.get("viewer_email") ?? "").trim() || null;
  const sessionId = String(formData.get("session_id") ?? "").trim() || null;

  if (!shareId || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return;

  const { createServiceClient, hasSupabaseServiceEnv } = await import("@/lib/supabase/server");
  if (!hasSupabaseServiceEnv()) return;
  const supabase = createServiceClient();

  // Validate the share exists and is still valid before recording.
  const { data: share } = await supabase
    .from("data_room_shares")
    .select("organization_id, room_id, revoked_at, expires_at, label, notify_on_open, created_by")
    .eq("id", shareId)
    .maybeSingle();
  if (!share || share.revoked_at) return;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return;

  const shareData = share as {
    organization_id: string;
    room_id: string | null;
    revoked_at: string | null;
    expires_at: string | null;
    label: string | null;
    notify_on_open: boolean;
    created_by: string | null;
  };

  await supabase
    .from("data_room_views")
    .insert({
      organization_id: shareData.organization_id,
      share_id: shareId,
      room_id: shareData.room_id,
      document_id: documentId,
      kind: documentId ? "document" : "room",
      viewer_email: viewerEmail,
      duration_seconds: durationSeconds,
      session_id: sessionId,
    } as never)
    .then(() => undefined, () => undefined);

  // GP notification: email the share creator when notify_on_open is set.
  if (shareData.notify_on_open && shareData.created_by) {
    void notifyGpOnOpen({
      supabase,
      creatorId: shareData.created_by,
      orgId: shareData.organization_id,
      shareLabel: shareData.label,
      viewerEmail,
    }).catch(() => undefined);
  }
}

async function notifyGpOnOpen(args: {
  supabase: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>;
  creatorId: string;
  orgId: string;
  shareLabel: string | null;
  viewerEmail: string | null;
}): Promise<void> {
  const { sendEmail: send } = await import("@/lib/email");
  // Fetch creator email from auth.users via the profiles table or org members.
  // Fall back to organization members — use created_by as principal_id.
  const { data: principal } = await args.supabase.auth.admin
    .getUserById(args.creatorId)
    .catch(() => ({ data: null }));
  const gpEmail = (principal as { user?: { email?: string } } | null)?.user?.email;
  if (!gpEmail) return;

  const { data: orgRow } = await args.supabase
    .from("organizations")
    .select("name")
    .eq("id", args.orgId)
    .maybeSingle();
  const orgName = escapeHtml((orgRow as { name: string } | null)?.name ?? "your fund");
  const label = escapeHtml(args.shareLabel ?? "your data room link");
  const safeViewer = args.viewerEmail ? escapeHtml(args.viewerEmail) : null;
  const viewer = safeViewer ? ` by ${safeViewer}` : "";
  const subject = `Your data room link was opened${viewer}`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #111111; border: 1px solid #222222; border-radius: 12px; overflow: hidden;">
    <div style="padding: 6px 24px; background: #F59E0B;">
      <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #0a0a0a; text-transform: uppercase;">FundExecs OS</span>
    </div>
    <div style="padding: 32px 24px;">
      <h1 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F5; font-weight: 700;">Someone opened your link</h1>
      <p style="margin: 0; font-size: 15px; color: #AAAAAA;">Your share link <strong style="color: #F5F5F5;">${label}</strong> for <strong style="color: #F5F5F5;">${orgName}</strong> was just opened${viewer}.</p>
      ${safeViewer ? `<p style="margin: 16px 0 0; font-size: 13px; color: #888888;">Viewer email: ${safeViewer}</p>` : ""}
    </div>
  </div>
</body>
</html>`;
  await send({ orgId: args.orgId, to: { name: "", email: gpEmail }, subject, htmlBody: html });
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
