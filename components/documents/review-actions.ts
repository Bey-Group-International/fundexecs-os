"use server";

// What the operator can do from a document's review page: have Earn read it,
// accept it as complete, refile it where Earn suggests, and share a preview.
//
// Sharing is the one outward action here (gate tier 2, `share_materials`): Earn
// proposes the settings, the operator presses Create. Nothing reaches a
// counterparty on Earn's say-so.
import { revalidatePath } from "next/cache";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { canWriteOrg } from "@/lib/rbac";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { listRooms } from "@/lib/data-rooms.server";
import { getDocumentText } from "@/lib/document-text.server";
import { reviewDocumentText } from "@/lib/document-review.server";
import { insertShare, shareUrl } from "@/lib/data-room-shares.server";
import type { Document, DocumentReview } from "@/lib/supabase/database.types";

const SECTION_KEYS = new Set(DATA_ROOM_SECTIONS.map((s) => s.key));

function revalidateDoc(id: string): void {
  revalidatePath("/build/documents");
  revalidatePath("/build/data_room");
  revalidatePath(`/document/${id}/review`);
}

async function loadDoc(id: string) {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const doc = data as Document | null;
  if (!doc) return null;
  return { ctx: { ...ctx, orgId: ctx.orgId }, supabase, doc };
}

export type ReviewResult = { ok: true; review: DocumentReview } | { ok: false; error: string };

/**
 * Earn's review of the document's current file. Cached per storage object:
 * a repeat visit is instant, and a re-uploaded version is reviewed afresh.
 * `force` re-runs it (the operator fixed something outside the file, or wants
 * a second read).
 */
export async function runDocumentReview(id: string, opts: { force?: boolean } = {}): Promise<ReviewResult> {
  const loaded = await loadDoc(id);
  if (!loaded) return { ok: false, error: "That document no longer exists." };
  const { ctx, doc } = loaded;
  if (!doc.storage_key) return { ok: false, error: "This document has no uploaded file to review." };
  if (!hasSupabaseServiceEnv()) return { ok: false, error: "File storage is not configured." };

  // The org-scoped read above is the authorization; the service client only
  // does the caching, so a view-only member still gets a review to read.
  const db = createServiceClient();
  if (!opts.force) {
    const { data } = await db
      .from("document_reviews")
      .select("*")
      .eq("document_id", doc.id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    const cached = data as DocumentReview | null;
    if (cached && cached.storage_key === doc.storage_key) return { ok: true, review: cached };
  }

  const text = await getDocumentText({ orgId: ctx.orgId, documentId: doc.id, storageKey: doc.storage_key });
  const core = await reviewDocumentText({ name: doc.name, section: doc.doc_type ?? "other", text });
  const review: DocumentReview = {
    document_id: doc.id,
    organization_id: ctx.orgId,
    storage_key: doc.storage_key,
    ...core,
    reviewed_at: new Date().toISOString(),
  };
  await db.from("document_reviews").upsert(review as never, { onConflict: "document_id" });
  return { ok: true, review };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Accept as complete: the document moves to Ready. */
export async function acceptDocument(id: string): Promise<ActionResult> {
  const loaded = await loadDoc(id);
  if (!loaded) return { ok: false, error: "That document no longer exists." };
  if (!canWriteOrg(loaded.ctx.role)) return { ok: false, error: "Your role is view-only." };
  const { error } = await loaded.supabase
    .from("documents")
    .update({ status: "ready" })
    .eq("id", id)
    .eq("organization_id", loaded.ctx.orgId);
  if (error) return { ok: false, error: "Could not update that document." };
  revalidateDoc(id);
  return { ok: true };
}

/** Send it back to Review (undo an accept). */
export async function reopenDocument(id: string): Promise<ActionResult> {
  const loaded = await loadDoc(id);
  if (!loaded) return { ok: false, error: "That document no longer exists." };
  if (!canWriteOrg(loaded.ctx.role)) return { ok: false, error: "Your role is view-only." };
  const { error } = await loaded.supabase
    .from("documents")
    .update({ status: "review" })
    .eq("id", id)
    .eq("organization_id", loaded.ctx.orgId);
  if (error) return { ok: false, error: "Could not update that document." };
  revalidateDoc(id);
  return { ok: true };
}

/** File the document under the section Earn suggested (or any other). */
export async function refileDocument(id: string, section: string): Promise<ActionResult> {
  if (!SECTION_KEYS.has(section)) return { ok: false, error: "Unknown section." };
  const loaded = await loadDoc(id);
  if (!loaded) return { ok: false, error: "That document no longer exists." };
  if (!canWriteOrg(loaded.ctx.role)) return { ok: false, error: "Your role is view-only." };
  const { error } = await loaded.supabase
    .from("documents")
    .update({ doc_type: section })
    .eq("id", id)
    .eq("organization_id", loaded.ctx.orgId);
  if (error) return { ok: false, error: "Could not refile that document." };
  revalidateDoc(id);
  return { ok: true };
}

export type ShareResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * A link to this one document, opened in the investor viewer with the chosen
 * controls. It rides on the firm's default room (every link belongs to a room,
 * and archiving the room ends it) but reaches only this document — whether or
 * not it has been published into any room.
 */
export async function createDocumentShare(input: {
  documentId: string;
  label: string;
  expiresInDays: number | null;
  requireEmail: boolean;
  requireNda: boolean;
  password: string;
  recipientEmail: string;
  allowDownload: boolean;
  watermark: boolean;
  notifyOnOpen: boolean;
}): Promise<ShareResult> {
  const loaded = await loadDoc(input.documentId);
  if (!loaded) return { ok: false, error: "That document no longer exists." };
  const { ctx, supabase, doc } = loaded;
  if (!canWriteOrg(ctx.role)) return { ok: false, error: "Your role is view-only. Ask an owner or admin to share this." };
  if (!doc.storage_key && !doc.content) return { ok: false, error: "There is nothing in this document to share yet." };

  const recipient = input.recipientEmail.trim();
  if (recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { ok: false, error: "That recipient email doesn't look right." };
  }

  const rooms = await listRooms(ctx.orgId);
  const room = rooms.find((r) => r.is_default) ?? rooms[0];
  if (!room) return { ok: false, error: "Open the Data Room once to set it up, then share." };

  const created = await insertShare(supabase, {
    orgId: ctx.orgId,
    userId: ctx.userId,
    roomId: room.id,
    documentId: doc.id,
    label: input.label.trim() || doc.name,
    expiresInDays: input.expiresInDays,
    requireEmail: input.requireEmail || input.requireNda,
    requireNda: input.requireNda,
    ndaText: null,
    password: input.password.trim() || null,
    recipientEmail: recipient || null,
    notifyOnOpen: input.notifyOnOpen,
    allowedSections: null,
    allowDownload: input.allowDownload,
    watermark: input.watermark,
  });
  if (!created) return { ok: false, error: "Could not create that link." };
  revalidateDoc(doc.id);
  return { ok: true, url: shareUrl(created.token) };
}
