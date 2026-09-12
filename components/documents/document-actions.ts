"use server";

// Documents is the library of record: everything the firm holds or creates
// lives here, drafts included. Nothing in this file publishes anything — a
// document reaches an audience only when it is explicitly published into a data
// room (components/build/room-actions.ts). That boundary is the whole point of
// the split, so keep authoring here and sharing there.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { isUploadedFile } from "@/lib/document-files";
import { removeDocumentPrefix } from "@/lib/document-storage.server";
import type { Document, DocumentStatus, DocumentVersion } from "@/lib/supabase/database.types";
import { sendEmail, documentUpdatedEmail } from "@/lib/email";

const SECTION_KEYS = new Set(DATA_ROOM_SECTIONS.map((s) => s.key));
// A "use server" module may export only async functions, so these stay local.
const LIBRARY = "/build/documents";
const ROOMS = "/build/data_room";

function section(formData: FormData): string {
  const s = String(formData.get("section") ?? "").trim();
  return SECTION_KEYS.has(s) ? s : "other";
}

// Accept only real http(s) links so a stored document URL can never carry a
// javascript:/data: payload into the rendered <a href> (the renderer also guards).
function safeLink(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    // not a valid absolute URL
  }
  return null;
}

/** Revalidate both surfaces: the library that owns the document and the rooms
 * that may publish it. */
function revalidateBoth(docId?: string): void {
  revalidatePath(LIBRARY);
  revalidatePath(ROOMS);
  if (docId) revalidatePath(`/document/${docId}`);
}

// Add a document as a link (no file storage). The external URL is held in
// `storage_key`; the section is the `doc_type`.
export async function addDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const name = String(formData.get("name") ?? "").trim();
  const link = safeLink(String(formData.get("url") ?? ""));
  if (!name || !link) return;
  const supabase = await createServerClient();
  await supabase.from("documents").insert({
    organization_id: ctx.orgId,
    name,
    doc_type: section(formData),
    storage_key: link,
    mime_type: "text/uri-list",
    uploaded_by: ctx.userId,
  });
  revalidateBoth();
}

// Rename / re-categorize a document, and update its inline content when present.
export async function updateDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  const patch: Partial<Document> = { name, doc_type: section(formData) };
  // Only the fields actually submitted are touched.
  if (formData.get("content") !== null) {
    patch.content = String(formData.get("content") ?? "").trim() || null;
  }
  if (formData.get("url") !== null) {
    patch.storage_key = safeLink(String(formData.get("url") ?? "")) ?? null;
  }

  const supabase = await createServerClient();
  await supabase.from("documents").update(patch).eq("id", id).eq("organization_id", ctx.orgId);

  // Snapshot version on every save (content only — links have no content to version).
  if (patch.content !== undefined) {
    await supabase.from("document_versions").insert({
      document_id: id,
      organization_id: ctx.orgId,
      content: patch.content ?? null,
      name: patch.name ?? name,
      saved_by: ctx.userId,
    } as never);
  }
  revalidateBoth(id);

  // Notify only the LPs who can actually see this document — i.e. recipients of
  // active links on rooms the document is published into. An edit to an
  // unpublished draft reaches nobody.
  void notifyPublishedShareRecipients(ctx.orgId, id, name).catch(() => undefined);
}

async function notifyPublishedShareRecipients(
  orgId: string,
  documentId: string,
  docName: string,
): Promise<void> {
  const supabase = await createServerClient();

  // Which rooms is this document published into?
  const { data: manifest } = await supabase
    .from("data_room_documents")
    .select("room_id")
    .eq("organization_id", orgId)
    .eq("document_id", documentId);
  const roomIds = [...new Set((manifest ?? []).map((r) => r.room_id as string))];
  if (roomIds.length === 0) return;

  const [{ data: orgRow }, { data: shareRows }, { data: docRow }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    supabase
      .from("data_room_shares")
      .select("token, recipient_email, room_id, expires_at, allowed_sections")
      .eq("organization_id", orgId)
      .in("room_id", roomIds)
      .is("revoked_at", null)
      .not("recipient_email", "is", null),
    supabase.from("documents").select("doc_type").eq("id", documentId).maybeSingle(),
  ]);
  if (!orgRow || !shareRows || shareRows.length === 0) return;

  // Tell only the people who can actually open it. A link that has expired, or
  // whose allowlist excludes this document's section, would otherwise get mail
  // naming a document it cannot reach.
  const section = (docRow as { doc_type: string | null } | null)?.doc_type ?? "other";
  const now = Date.now();
  const shares = (
    shareRows as Array<{
      token: string;
      recipient_email: string | null;
      expires_at: string | null;
      allowed_sections: string[] | null;
    }>
  ).filter((s) => {
    if (s.expires_at && new Date(s.expires_at).getTime() < now) return false;
    if (s.allowed_sections !== null && !s.allowed_sections.includes(section)) return false;
    return true;
  });
  if (shares.length === 0) return;

  const orgName = orgRow.name as string;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.fundexecs.com";
  await Promise.all(
    (shares as Array<{ token: string; recipient_email: string | null }>)
      .filter((s) => s.recipient_email)
      .map((s) => {
        const { subject, html } = documentUpdatedEmail(orgName, docName, `${baseUrl}/dataroom/${s.token}`);
        return sendEmail({ orgId, to: { name: "", email: s.recipient_email! }, subject, htmlBody: html });
      }),
  );
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createServerClient();
  // The manifest cascades on delete, so removing a document also withdraws it
  // from every room it was published into.
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  // Only once the row is gone: the rows in `document_versions` cascade with it,
  // so this is the last moment anything still references those objects. Every
  // version of the file shares the document's prefix, which is why the whole
  // prefix goes rather than the current storage_key alone — otherwise deleting
  // a document would leave its earlier files in the bucket for good.
  if (!error) await removeDocumentPrefix(ctx.orgId, id);
  revalidateBoth();
}

// Set a document's authoring status (draft | review | ready). Status is an
// internal signal only — it never publishes or unpublishes anything.
export async function updateDocumentStatus(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const s = String(formData.get("status") ?? "");
  if (!id || !["draft", "review", "ready"].includes(s)) return;
  const supabase = await createServerClient();
  await supabase
    .from("documents")
    .update({ status: s as DocumentStatus })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidateBoth(id);
}

// --- Document version history ---------------------------------------------

export async function listDocumentVersions(docId: string): Promise<DocumentVersion[]> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("document_versions")
    .select("*")
    .eq("document_id", docId)
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as DocumentVersion[];
}

export async function restoreDocumentVersion(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const versionId = String(formData.get("version_id") ?? "");
  const docId = String(formData.get("doc_id") ?? "");
  if (!versionId || !docId) return;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("document_versions")
    .select("*")
    .eq("id", versionId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const version = data as DocumentVersion | null;
  if (!version) return;

  // Snapshot what is being replaced before replacing it, so restoring is
  // reversible. Without this, restoring an old version of a document discards
  // the current one — including its file, which has no other copy.
  const { data: currentRow } = await supabase
    .from("documents")
    .select("*")
    .eq("id", docId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const current = currentRow as Document | null;
  if (!current) return;
  if (current.storage_key || current.content) {
    await supabase.from("document_versions").insert({
      document_id: docId,
      organization_id: ctx.orgId,
      name: current.name,
      content: current.content ?? null,
      storage_key: current.storage_key ?? null,
      mime_type: current.mime_type ?? null,
      size_bytes: current.size_bytes ?? null,
      saved_by: ctx.userId,
    } as never);
  }

  // A version restores whole. Restoring the name and content but leaving the
  // current file in place would put one version's title on another's document.
  // Older snapshots predate file versioning and carry no storage_key; those
  // restore as content-only, leaving whatever file is attached alone.
  const patch: Partial<Document> = { content: version.content, name: version.name };
  if (version.storage_key !== null || isUploadedFile(current.storage_key)) {
    patch.storage_key = version.storage_key;
    patch.mime_type = version.mime_type;
    patch.size_bytes = version.size_bytes;
  }
  await supabase
    .from("documents")
    .update(patch)
    .eq("id", docId)
    .eq("organization_id", ctx.orgId);
  revalidateBoth(docId);
}

// Create a document in a section and open it in the builder. The library's
// "+ New" action.
export async function newDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const sectionKey = String(formData.get("section") ?? "").trim();
  const sectionDef = DATA_ROOM_SECTIONS.find((s) => s.key === sectionKey);
  if (!sectionDef) return;
  const name = String(formData.get("name") ?? "").trim() || sectionDef.label;

  const supabase = await createServerClient();
  const { data: created } = await supabase
    .from("documents")
    .insert({
      organization_id: ctx.orgId,
      name,
      doc_type: sectionDef.key,
      mime_type: "text/markdown",
      uploaded_by: ctx.userId,
    })
    .select("id")
    .maybeSingle();
  revalidateBoth();
  if (created?.id) redirect(`/document/${created.id}`);
}
