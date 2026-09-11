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
 * Next free position in a room. New publications used to copy
 * `documents.sort_order`, but nothing writes that column any more, so every
 * manifest row landed on 0 — leaving the reorder arrows swapping whichever tied
 * row the database happened to return. Appending at the end gives each document
 * its own position instead.
 *
 * This is a read then a write, not an atomic allocation: two publications
 * racing in the same instant can both read the same maximum and land on the
 * same position, since the manifest's unique constraint is on
 * (room_id, document_id) rather than (room_id, sort_order). Order stays
 * deterministic regardless — every reader breaks ties by name
 * (groupRoomDocuments, buildViewerPayload, and moveRoomDocument below) — so the
 * two documents sort alphabetically against each other rather than by
 * insertion. Making positions strictly distinct would need a unique index and
 * a transactional allocation; that is a schema change, not a fix.
 */
async function nextSortOrder(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  orgId: string,
  roomId: string,
): Promise<number> {
  const { data } = await supabase
    .from("data_room_documents")
    .select("sort_order")
    .eq("organization_id", orgId)
    .eq("room_id", roomId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const top = (data as { sort_order: number } | null)?.sort_order;
  return typeof top === "number" ? top + 1 : 0;
}

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

  // Upsert, not insert: the table has unique (room_id, document_id), and a
  // plain insert on an already-published document raises a duplicate-key error
  // that this action would discard — making a re-publish a silent failure
  // rather than the no-op it reads as.
  await supabase.from("data_room_documents").upsert(
    {
      organization_id: orgId,
      room_id: roomId,
      document_id: documentId,
      sort_order: await nextSortOrder(supabase, orgId, roomId),
      added_by: ctx.userId,
    },
    { onConflict: "room_id,document_id", ignoreDuplicates: true },
  );
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
