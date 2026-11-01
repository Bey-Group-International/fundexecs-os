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
import { roomSectionKey } from "@/lib/data-rooms";
import { DataRoomReadError, logReadFailure, orThrowRead } from "@/lib/data-room-errors";
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
      /** This file requires the reader's signature (they have it, or the caller skipped the check). */
      signatureRequired: boolean;
    }
  | {
      ok: false;
      /**
       * Set only when the answer is "we couldn't find out", never for a denial.
       * Callers answer 503 / "try again" for it, not "this link is dead".
       */
      unavailable?: true;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
export async function resolveSharedDocument(
  token: string,
  documentId: string,
  /** Only the signing action passes this: it must reach a file the reader has not yet signed. */
  opts: { skipSignature?: boolean } = {},
): Promise<ShareAccess> {
  // Not an id at all: a denial, decided before the database sees it. Otherwise
  // a malformed id would reach a uuid column, come back as an error, and be
  // reported as an outage instead of a miss.
  if (typeof documentId !== "string" || !UUID.test(documentId)) return { ok: false };
  try {
    return await resolveShared(token, documentId, opts);
  } catch (error) {
    // Fails closed (nothing is served) but says so honestly: the caller can
    // tell "we couldn't check" from "you may not have this".
    if (error instanceof DataRoomReadError) {
      logReadFailure(error);
      return { ok: false, unavailable: true };
    }
    throw error;
  }
}

async function resolveShared(
  token: string,
  documentId: string,
  opts: { skipSignature?: boolean },
): Promise<ShareAccess> {
  if (!hasSupabaseServiceEnv()) return { ok: false };
  const supabase = createServiceClient();

  const shareRow = orThrowRead(
    "share",
    await supabase.from("data_room_shares").select("*").eq("token", token).maybeSingle(),
  );
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

  if (share.document_id && share.document_id !== documentId) return { ok: false };

  // The room's manifest row for this file: membership (unless a single-document
  // link, which reaches its one document published or not) and whether the
  // file requires a signature. Being in the org's library is not enough — an
  // unpublished draft must stay unreachable even to someone holding a valid
  // token and the document's id.
  const manifestRow = orThrowRead(
    "manifest",
    await supabase
      .from("data_room_documents")
      .select("id, require_signature")
      .eq("organization_id", share.organization_id)
      .eq("room_id", roomId)
      .eq("document_id", documentId)
      .maybeSingle(),
  );
  // An errored read throws above. For a single-document link it would otherwise
  // look like "no signature required" and open a file that needs one.
  if (!share.document_id && !manifestRow) return { ok: false };
  const signatureRequired = Boolean((manifestRow as { require_signature?: boolean } | null)?.require_signature);

  const docRow = orThrowRead(
    "document",
    await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .eq("organization_id", share.organization_id)
      .maybeSingle(),
  );
  const doc = docRow as Document | null;
  if (!doc) return { ok: false };

  if (!share.document_id) {
    const allowed = share.allowed_sections ?? null;
    // Same section rule as the viewer, so a file the viewer lists under "Other"
    // is not refused here (or opened) on a different reading of its doc_type.
    if (allowed && !allowed.includes(roomSectionKey(doc.doc_type))) return { ok: false };
  }

  // A file that needs a signature stays shut — preview, open and download alike —
  // until this reader (by gate email) has signed it on this link.
  if (signatureRequired && !opts.skipSignature) {
    const { signedDocumentIds } = await import("@/lib/document-signing.server");
    const signed = await signedDocumentIds(supabase as never, share.id, pass?.email ?? null, [documentId]);
    if (!signed.has(documentId)) return { ok: false };
  }

  return { ok: true, supabase, share, doc, roomId, viewerEmail: pass?.email ?? null, signatureRequired };
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
