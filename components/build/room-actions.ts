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

  const now = new Date().toISOString();

  // Revoke the links BEFORE archiving. The order matters: archiving first and
  // failing here would leave a room the operator can no longer see, still
  // reachable through links they believe are dead. This way a failure leaves
  // the room visible with its links already closed — the safe half-state.
  const { error: revokeErr } = await supabase
    .from("data_room_shares")
    .update({ revoked_at: now })
    .eq("room_id", id)
    .eq("organization_id", ctx.orgId)
    .is("revoked_at", null);
  if (revokeErr) return;

  await supabase
    .from("data_rooms")
    .update({ archived_at: now })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  revalidatePath(ROOMS);
}

// --- Publishing ------------------------------------------------------------

/**
 * Publish a document into a room, at the end. Both rows are re-checked against
 * the caller's org before anything is written, so a stray id can't pull
 * another firm's document into a room. Idempotent — re-publishing is a no-op.
 *
 * The position is allocated inside publish_room_document (migration
 * 20261009171326), which takes a per-room lock, computes max+1 and inserts in
 * one transaction. The read-then-write this replaces let two publications
 * racing in the same room land on the same position; the manifest now holds a
 * unique (room_id, sort_order), so insertion order is authoritative. A failed
 * write throws rather than returning as though it published — the caller's
 * transition surfaces it through the error boundary instead of the document
 * silently never appearing.
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
    supabase.from("documents").select("id").eq("id", documentId).eq("organization_id", orgId).maybeSingle(),
  ]);
  if (!room || !doc) return;

  const { error } = await supabase.rpc("publish_room_document", {
    p_organization_id: orgId,
    p_room_id: roomId,
    p_document_id: documentId,
    p_added_by: ctx.userId,
  });
  if (error) throw new Error(`Couldn't publish the document: ${error.message}`);
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
    .select("id, doc_type, name")
    .eq("organization_id", orgId)
    .in("id", rows.map((r) => r.document_id));
  const docMeta = new Map(
    ((docRows ?? []) as { id: string; doc_type: string | null; name: string }[]).map((d) => [
      d.id,
      { section: d.doc_type ?? "other", name: d.name },
    ]),
  );
  const target = rows.find((r) => r.document_id === documentId);
  if (!target) return;

  // Sort peers the way groupRoomDocuments renders them — by sort_order, then
  // name. Ordering by sort_order alone leaves tied rows in whatever order the
  // database returns, so the arrows would swap rows other than the ones the
  // operator can see.
  const section = docMeta.get(documentId)?.section;
  const peers = rows
    .filter((r) => docMeta.get(r.document_id)?.section === section)
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        (docMeta.get(a.document_id)?.name ?? "").localeCompare(docMeta.get(b.document_id)?.name ?? ""),
    );

  const idx = peers.findIndex((r) => r.document_id === documentId);
  const swapWith = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= peers.length) return;

  // Exchange the two rows' positions in one transaction
  // (swap_room_document_positions, migration 20261009171326). Positions are
  // unique per room now, so a swap of adjacent peers is exactly the move the
  // operator sees — no section member can sit between them — and it never
  // renumbers across sections the way the old 0..n-1 rewrite did, which a
  // room-wide unique constraint could not admit. The deferred constraint
  // checks the final state, so the in-flight duplicate inside the swap is
  // fine. A row vanishing mid-move (rpc returns false) is a no-op, same as
  // the stale-form cases above; a failed write throws so the operator sees
  // the move didn't happen.
  const other = peers[swapWith];
  const { data: swapped, error } = await supabase.rpc("swap_room_document_positions", {
    p_organization_id: orgId,
    p_room_id: roomId,
    p_document_id: documentId,
    p_other_document_id: other.document_id,
  });
  if (error) throw new Error(`Couldn't reorder the document: ${error.message}`);
  if (!swapped) return;
  revalidatePath(ROOMS);
}
