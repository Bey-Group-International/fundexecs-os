// lib/data-room-access.server.ts
//
// The one answer to "may this token holder have this document?", shared by
// every public route that serves document bytes or previews.
//
// It used to live inline in the open route. Adding the preview route, the
// download route, and single-document links would have meant three copies of a
// security check that had already been gotten wrong once (the open route
// originally skipped the gate). One function means one place to get it right.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { gateSatisfied, readGatePass } from "@/lib/data-room-gate";
import { isRoomOpen } from "@/lib/data-room-viewer.server";
import type { DataRoomShare, Database, Document } from "@/lib/supabase/database.types";

export type ShareAccess =
  | {
      ok: true;
      supabase: SupabaseClient<Database>;
      share: DataRoomShare;
      doc: Document;
      roomId: string;
      /** Email the reader gave at the gate, when the link asked for one. */
      viewerEmail: string | null;
    }
  | { ok: false };

/** A share that exists, is not revoked, and has not expired. */
export function isShareLive(share: Pick<DataRoomShare, "revoked_at" | "expires_at"> | null): boolean {
  if (!share || share.revoked_at) return false;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return false;
  return true;
}

/**
 * Resolve a (token, document) pair to the document, or refuse.
 *
 * In order: the link is live; every gate it requires has been passed by this
 * browser (server-verified cookie); its room is open; the document is in scope —
 * for a single-document link it must BE that document, otherwise it must be in
 * the room's publish manifest; and the link's section allowlist admits it.
 */
export async function resolveSharedDocument(token: string, documentId: string): Promise<ShareAccess> {
  if (!hasSupabaseServiceEnv()) return { ok: false };
  const supabase = createServiceClient();

  const { data: shareRow } = await supabase
    .from("data_room_shares")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  const share = shareRow as DataRoomShare | null;
  if (!share || !isShareLive(share)) return { ok: false };

  const pass = await readGatePass(share.id);
  const passed = gateSatisfied(
    {
      require_email: share.require_email ?? false,
      require_nda: share.require_nda ?? false,
      password_hash: share.password_hash,
      allowed_email_domains: share.allowed_email_domains ?? null,
    },
    pass,
  );
  if (!passed) return { ok: false };

  const roomId = share.room_id;
  if (!roomId) return { ok: false };
  // An archived room serves nothing, whatever its links still say.
  if (!(await isRoomOpen(supabase, share.organization_id, roomId))) return { ok: false };

  if (share.document_id) {
    // A single-document link reaches exactly one document, published or not —
    // the operator chose it by name from its review page.
    if (share.document_id !== documentId) return { ok: false };
  } else {
    // Being in the org's library is not enough — an unpublished draft must stay
    // unreachable even to someone holding a valid token and the document's id.
    const { data: manifestRow } = await supabase
      .from("data_room_documents")
      .select("id")
      .eq("organization_id", share.organization_id)
      .eq("room_id", roomId)
      .eq("document_id", documentId)
      .maybeSingle();
    if (!manifestRow) return { ok: false };
  }

  const { data: docRow } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .eq("organization_id", share.organization_id)
    .maybeSingle();
  const doc = docRow as Document | null;
  if (!doc) return { ok: false };

  if (!share.document_id) {
    const allowed = share.allowed_sections ?? null;
    if (allowed && (!doc.doc_type || !allowed.includes(doc.doc_type))) return { ok: false };
  }

  return { ok: true, supabase, share, doc, roomId, viewerEmail: pass?.email ?? null };
}

/** The line stamped onto a watermarked page: who, and when. */
export function watermarkLabel(
  share: Pick<DataRoomShare, "recipient_email" | "label">,
  viewerEmail: string | null,
  now: Date = new Date(),
): string {
  const who = viewerEmail || share.recipient_email || share.label || "Confidential";
  const when = now.toISOString().slice(0, 16).replace("T", " ");
  return `${who} · ${when} UTC`;
}
