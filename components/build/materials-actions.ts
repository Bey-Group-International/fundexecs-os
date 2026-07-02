"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import type { Document, DocumentVersion } from "@/lib/supabase/database.types";

const SECTION_KEYS = new Set(DATA_ROOM_SECTIONS.map((s) => s.key));
const ROOM = "/build/data_room";

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

// Add a document as a link (no file storage). The external URL is held in
// `storage_key`; the section is the `doc_type`.
export async function addDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const name = String(formData.get("name") ?? "").trim();
  const link = safeLink(String(formData.get("url") ?? ""));
  if (!name || !link) return;
  const supabase = createServerClient();
  await supabase.from("documents").insert({
    organization_id: ctx.orgId,
    name,
    doc_type: section(formData),
    storage_key: link,
    mime_type: "text/uri-list",
    uploaded_by: ctx.userId,
  });
  revalidatePath(ROOM);
}

// Create a document in-app: a written note/memo stored inline (no file, no link).
export async function createDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const name = String(formData.get("name") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!name || !content) return;
  const supabase = createServerClient();
  await supabase.from("documents").insert({
    organization_id: ctx.orgId,
    name,
    doc_type: section(formData),
    content,
    mime_type: "text/markdown",
    uploaded_by: ctx.userId,
  });
  revalidatePath(ROOM);
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

  const supabase = createServerClient();
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
  revalidatePath(ROOM);
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createServerClient();
  await supabase.from("documents").delete().eq("id", id).eq("organization_id", ctx.orgId);
  revalidatePath(ROOM);
}

// Move a document up/down within its section. Normalizes sort_order across the
// section, then swaps the target with its neighbour.
export async function moveDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const dir = String(formData.get("dir") ?? "");
  if (!id || (dir !== "up" && dir !== "down")) return;
  const orgId = ctx.orgId;

  const supabase = createServerClient();
  const { data: target } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  const doc = target as Document | null;
  if (!doc) return;

  const { data: peerRows } = await supabase
    .from("documents")
    .select("*")
    .eq("organization_id", orgId)
    .eq("doc_type", doc.doc_type ?? "other")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const peers = (peerRows ?? []) as Document[];

  const idx = peers.findIndex((p) => p.id === id);
  const swapWith = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= peers.length) return;

  // Re-number sequentially after swapping the two neighbours, so order is stable
  // even when prior sort_order values were all 0 (the column default).
  const reordered = [...peers];
  [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
  await Promise.all(
    reordered.map((p, i) =>
      supabase.from("documents").update({ sort_order: i }).eq("id", p.id).eq("organization_id", orgId),
    ),
  );
  revalidatePath(ROOM);
}

// Set a document's publish status (draft | review | ready).
export async function updateDocumentStatus(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  const s = String(formData.get("status") ?? "");
  if (!id || !["draft", "review", "ready"].includes(s)) return;
  const supabase = createServerClient();
  await supabase
    .from("documents")
    .update({ status: s as import("@/lib/supabase/database.types").DocumentStatus })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(ROOM);
}

// --- Shareable data-room links --------------------------------------------

/** Compute a simple SHA-256 based hash for data-room password protection.
 *  Stored as "sha256:<hex>" to allow future algorithm migration. */
async function hashPassword(password: string): Promise<string> {
  const { createHash } = await import("crypto");
  const hex = createHash("sha256").update(password).digest("hex");
  return `sha256:${hex}`;
}

async function comparePassword(password: string, stored: string): Promise<boolean> {
  const expected = await hashPassword(password);
  return expected === stored;
}

export async function createShare(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const label = String(formData.get("label") ?? "").trim() || null;
  const days = Number(String(formData.get("expires_in_days") ?? "").trim());
  const expires_at =
    Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;

  const requireEmail = formData.get("require_email") === "1";
  const requireNda = formData.get("require_nda") === "1";
  const ndaText = String(formData.get("nda_text") ?? "").trim() || null;
  const passwordRaw = String(formData.get("password") ?? "").trim();
  const password_hash = passwordRaw ? await hashPassword(passwordRaw) : null;

  const supabase = createServerClient();
  await supabase.from("data_room_shares").insert({
    organization_id: ctx.orgId,
    label,
    expires_at,
    created_by: ctx.userId,
    require_email: requireEmail,
    require_nda: requireNda,
    nda_text: ndaText,
    password_hash,
  } as never);
  revalidatePath(ROOM);
}

/** Verify a data-room password from the public viewer (no auth required). */
export async function verifySharePassword(token: string, password: string): Promise<boolean> {
  const { createServiceClient, hasSupabaseServiceEnv } = await import("@/lib/supabase/server");
  if (!hasSupabaseServiceEnv()) return false;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("data_room_shares")
    .select("password_hash, revoked_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data?.password_hash) return false;
  if (data.revoked_at) return false;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return false;
  return comparePassword(password, data.password_hash);
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
    .select("organization_id, revoked_at, expires_at")
    .eq("id", shareId)
    .maybeSingle();
  if (!share || share.revoked_at) return;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return;

  await supabase
    .from("data_room_views")
    .insert({
      organization_id: share.organization_id,
      share_id: shareId,
      document_id: documentId,
      kind: documentId ? "document" : "room",
      viewer_email: viewerEmail,
      duration_seconds: durationSeconds,
      session_id: sessionId,
    } as never)
    .then(() => undefined, () => undefined);
}

export async function revokeShare(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createServerClient();
  await supabase
    .from("data_room_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(ROOM);
}

// --- Document version history --------------------------------------------------
export async function listDocumentVersions(docId: string): Promise<DocumentVersion[]> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return [];
  const supabase = createServerClient();
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
  const supabase = createServerClient();
  const { data } = await supabase
    .from("document_versions")
    .select("*")
    .eq("id", versionId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const version = data as DocumentVersion | null;
  if (!version) return;
  await supabase
    .from("documents")
    .update({ content: version.content, name: version.name })
    .eq("id", docId)
    .eq("organization_id", ctx.orgId);
  revalidatePath(ROOM);
  revalidatePath(`/document/${docId}`);
}

// Open a section's builder: jump to the section's most recent document, creating
// an empty one first when the section has none. Drives the coverage list — each
// section/document is a click into the document builder.
export async function openSection(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const sectionKey = String(formData.get("section") ?? "").trim();
  const sectionDef = DATA_ROOM_SECTIONS.find((s) => s.key === sectionKey);
  if (!sectionDef) return;

  const supabase = createServerClient();
  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("doc_type", sectionDef.key)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let id = existing?.id;
  if (!id) {
    const { data: created } = await supabase
      .from("documents")
      .insert({
        organization_id: ctx.orgId,
        name: sectionDef.label,
        doc_type: sectionDef.key,
        mime_type: "text/markdown",
        uploaded_by: ctx.userId,
      })
      .select("id")
      .maybeSingle();
    id = created?.id;
  }
  if (id) redirect(`/document/${id}`);
}
