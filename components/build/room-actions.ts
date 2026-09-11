"use server";

// Data-room lifecycle: create/rename/archive a room, and publish or withdraw
// documents from it. Nothing here creates or edits a document — the library
// (components/documents/document-actions.ts) owns that. These actions only
// decide who gets to see what already exists.
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

const ROOMS = "/build/data_room";
const LIBRARY = "/build/documents";

export async function createRoom(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const description = String(formData.get("description") ?? "").trim() || null;

  const supabase = await createServerClient();
  // The first room an org creates becomes its default.
  const { count } = await supabase
    .from("data_rooms")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.orgId);

  await supabase.from("data_rooms").insert({
    organization_id: ctx.orgId,
    name,
    description,
    is_default: (count ?? 0) === 0,
    created_by: ctx.userId,
  });
  revalidatePath(ROOMS);
}

export async function renameRoom(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("room_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;
  const description = formData.get("description") !== null
    ? String(formData.get("description") ?? "").trim() || null
    : undefined;

  const patch: { name: string; description?: string | null } = { name };
  if (description !== undefined) patch.description = description;

  const supabase = await createServerClient();
  await supabase
    .from("data_rooms")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(ROOMS);
}

/**
 * Archive a room. Its links stop working (they cascade off the room) and it
 * leaves the switcher, but the documents themselves are untouched — they still
 * live in the library. The default room can't be archived; there has to be
 * somewhere for Build's coverage prompts to point.
 */
export async function archiveRoom(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("room_id") ?? "");
  if (!id) return;

  const supabase = await createServerClient();
  const { data: room } = await supabase
    .from("data_rooms")
    .select("is_default")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!room || (room as { is_default: boolean }).is_default) return;

  await supabase
    .from("data_rooms")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  // Revoke the room's live links rather than leaving dangling tokens.
  await supabase
    .from("data_room_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("room_id", id)
    .eq("organization_id", ctx.orgId)
    .is("revoked_at", null);
  revalidatePath(ROOMS);
}

// --- Publishing ------------------------------------------------------------

/**
 * Publish a document into a room. Both rows are re-checked against the caller's
 * org before the manifest row is written, so a stray id can't pull another
 * firm's document into a room. Idempotent — re-publishing is a no-op.
 */
export async function publishDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const roomId = String(formData.get("room_id") ?? "");
  const documentId = String(formData.get("document_id") ?? "");
  if (!roomId || !documentId) return;
  const orgId = ctx.orgId;

  const supabase = await createServerClient();
  const [{ data: room }, { data: doc }] = await Promise.all([
    supabase.from("data_rooms").select("id").eq("id", roomId).eq("organization_id", orgId).maybeSingle(),
    supabase.from("documents").select("id, sort_order").eq("id", documentId).eq("organization_id", orgId).maybeSingle(),
  ]);
  if (!room || !doc) return;

  await supabase.from("data_room_documents").insert({
    organization_id: orgId,
    room_id: roomId,
    document_id: documentId,
    sort_order: (doc as { sort_order: number }).sort_order ?? 0,
    added_by: ctx.userId,
  });
  revalidatePath(ROOMS);
  revalidatePath(LIBRARY);
}

/** Withdraw a document from a room. The document itself is untouched. */
export async function unpublishDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const roomId = String(formData.get("room_id") ?? "");
  const documentId = String(formData.get("document_id") ?? "");
  if (!roomId || !documentId) return;

  const supabase = await createServerClient();
  await supabase
    .from("data_room_documents")
    .delete()
    .eq("organization_id", ctx.orgId)
    .eq("room_id", roomId)
    .eq("document_id", documentId);
  revalidatePath(ROOMS);
  revalidatePath(LIBRARY);
}

/** Publish every document filed under a section into a room, in one click. */
export async function publishSection(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const roomId = String(formData.get("room_id") ?? "");
  const sectionKey = String(formData.get("section") ?? "").trim();
  if (!roomId || !sectionKey) return;
  const orgId = ctx.orgId;

  const supabase = await createServerClient();
  const { data: room } = await supabase
    .from("data_rooms")
    .select("id")
    .eq("id", roomId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!room) return;

  const { data: docs } = await supabase
    .from("documents")
    .select("id, sort_order")
    .eq("organization_id", orgId)
    .eq("doc_type", sectionKey)
    .order("sort_order", { ascending: true });
  const rows = (docs ?? []) as { id: string; sort_order: number }[];
  if (rows.length === 0) return;

  await supabase.from("data_room_documents").insert(
    rows.map((d) => ({
      organization_id: orgId,
      room_id: roomId,
      document_id: d.id,
      sort_order: d.sort_order ?? 0,
      added_by: ctx.userId,
    })),
  );
  revalidatePath(ROOMS);
  revalidatePath(LIBRARY);
}

/** Reorder a published document within its section in this room. */
export async function moveRoomDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const roomId = String(formData.get("room_id") ?? "");
  const documentId = String(formData.get("document_id") ?? "");
  const dir = String(formData.get("dir") ?? "");
  if (!roomId || !documentId || (dir !== "up" && dir !== "down")) return;
  const orgId = ctx.orgId;

  const supabase = await createServerClient();
  const { data: manifest } = await supabase
    .from("data_room_documents")
    .select("id, document_id, sort_order")
    .eq("organization_id", orgId)
    .eq("room_id", roomId)
    .order("sort_order", { ascending: true });
  const rows = (manifest ?? []) as { id: string; document_id: string; sort_order: number }[];
  if (rows.length === 0) return;

  // Only peers in the same section swap — order is meaningful within a section,
  // not across the whole room.
  const { data: docRows } = await supabase
    .from("documents")
    .select("id, doc_type")
    .eq("organization_id", orgId)
    .in("id", rows.map((r) => r.document_id));
  const sectionOf = new Map(
    ((docRows ?? []) as { id: string; doc_type: string | null }[]).map((d) => [d.id, d.doc_type ?? "other"]),
  );
  const target = rows.find((r) => r.document_id === documentId);
  if (!target) return;
  const peers = rows.filter((r) => sectionOf.get(r.document_id) === sectionOf.get(documentId));

  const idx = peers.findIndex((r) => r.document_id === documentId);
  const swapWith = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= peers.length) return;

  const reordered = [...peers];
  [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
  await Promise.all(
    reordered.map((r, i) =>
      supabase
        .from("data_room_documents")
        .update({ sort_order: i })
        .eq("id", r.id)
        .eq("organization_id", orgId),
    ),
  );
  revalidatePath(ROOMS);
}
