"use server";

// The composer's file actions: a signed upload for a file from the computer,
// the library documents it can attach, and a data-room link for one document.
// Sending the files is part of the reply itself (actions.ts → deliver-reply).

import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createAttachmentTicket,
  listAttachableDocuments,
  listRoomDocuments,
  mintRoomLink,
  type AttachableDocument,
  type AttachmentTicket,
  type RoomLink,
} from "@/lib/inbox/attachments.server";

export async function requestAttachmentUpload(input: { name: string; size: number }): Promise<AttachmentTicket> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const rl = checkRateLimit({ key: `org:${auth.ctx.orgId}:inbox-attachment-upload`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return { ok: false, error: "Too many uploads at once — try again in a minute." };
  return createAttachmentTicket(auth.ctx.orgId, input);
}

export async function listInboxDocuments(): Promise<{ library: AttachableDocument[]; rooms: Array<{ id: string; name: string; roomName: string }> }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { library: [], rooms: [] };
  const supabase = await createServerClient();
  const [library, rooms] = await Promise.all([
    listAttachableDocuments(supabase, auth.ctx.orgId).catch(() => []),
    listRoomDocuments(auth.ctx.orgId).catch(() => []),
  ]);
  return { library, rooms };
}

export async function createInboxRoomLink(threadId: string, documentId: string): Promise<RoomLink> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (!documentId) return { ok: false, error: "Pick a document." };
  const supabase = await createServerClient();
  const { data: thread } = await supabase
    .from("inbox_threads")
    .select("counterparty_name, counterparty_email, subject")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", threadId)
    .maybeSingle();
  const t = thread as { counterparty_name: string | null; counterparty_email: string | null; subject: string } | null;
  if (!t) return { ok: false, error: "Conversation not found." };
  return mintRoomLink(supabase, {
    orgId: auth.ctx.orgId,
    userId: auth.ctx.userId,
    documentId,
    label: `Inbox: ${t.counterparty_name ?? t.counterparty_email ?? t.subject}`,
  });
}
