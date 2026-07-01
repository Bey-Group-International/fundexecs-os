"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import type { Document } from "@/lib/supabase/database.types";

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
    .update({ status: s })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(ROOM);
}

// --- Shareable data-room links --------------------------------------------
export async function createShare(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const label = String(formData.get("label") ?? "").trim() || null;
  const days = Number(String(formData.get("expires_in_days") ?? "").trim());
  const expires_at =
    Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  const supabase = createServerClient();
  await supabase.from("data_room_shares").insert({
    organization_id: ctx.orgId,
    label,
    expires_at,
    created_by: ctx.userId,
  });
  revalidatePath(ROOM);
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
