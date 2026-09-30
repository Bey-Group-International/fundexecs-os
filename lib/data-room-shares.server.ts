// lib/data-room-shares.server.ts
//
// Minting a data-room link. Shared by the room's Share panel (a link into a
// whole room) and a document's review page (a link to that one document), so
// the two cannot drift on how passwords are hashed or what a link records.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, shareGrantedEmail } from "@/lib/email";
import type { Database } from "@/lib/supabase/database.types";

export async function hashSharePassword(password: string): Promise<string> {
  const { pbkdf2Sync, randomBytes } = await import("crypto");
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
  return `pbkdf2:${salt}:${hash}`;
}

export interface ShareInput {
  orgId: string;
  userId: string;
  roomId: string;
  /** Single-document link; null for a whole-room link. */
  documentId?: string | null;
  label: string | null;
  expiresInDays: number | null;
  requireEmail: boolean;
  requireNda: boolean;
  ndaText: string | null;
  password: string | null;
  recipientEmail: string | null;
  notifyOnOpen: boolean;
  allowedSections: string[] | null;
  allowDownload: boolean;
  watermark: boolean;
}

export function shareUrl(token: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.fundexecs.com";
  return `${baseUrl}/dataroom/${token}`;
}

/**
 * Insert the link and, when a recipient is named, email it to them. The caller
 * has already checked the room (and document) belong to `orgId`; RLS on the
 * caller's client enforces that they may write.
 */
export async function insertShare(
  supabase: SupabaseClient<Database>,
  input: ShareInput,
): Promise<{ token: string } | null> {
  const expires_at =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
      : null;
  const password_hash = input.password ? await hashSharePassword(input.password) : null;

  const { data: inserted } = await supabase
    .from("data_room_shares")
    .insert({
      organization_id: input.orgId,
      room_id: input.roomId,
      document_id: input.documentId ?? null,
      label: input.label,
      expires_at,
      created_by: input.userId,
      require_email: input.requireEmail,
      require_nda: input.requireNda,
      nda_text: input.ndaText,
      password_hash,
      recipient_email: input.recipientEmail,
      notify_on_open: input.notifyOnOpen,
      // A document link is already scoped to one document; a section allowlist
      // on top of it could only ever hide that document.
      allowed_sections: input.documentId ? null : input.allowedSections,
      allow_download: input.allowDownload,
      watermark: input.watermark,
    } as never)
    .select("token")
    .maybeSingle();
  const token = (inserted as { token: string } | null)?.token;
  if (!token) return null;

  if (input.recipientEmail) {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", input.orgId)
      .maybeSingle();
    if (orgRow) {
      const { subject, html } = shareGrantedEmail(
        (orgRow as { name: string }).name,
        input.label,
        shareUrl(token),
        expires_at,
      );
      void sendEmail({
        orgId: input.orgId,
        to: { name: "", email: input.recipientEmail },
        subject,
        htmlBody: html,
      }).catch(() => undefined);
    }
  }
  return { token };
}
