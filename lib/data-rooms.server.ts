// lib/data-rooms.server.ts
// Server-side reads for data rooms. Deliberately not a "use server" module:
// these are called from server components, never exposed as callable actions.
import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { DEFAULT_ROOM_NAME, type RoomDocument } from "@/lib/data-rooms";
import type { DataRoom, Document } from "@/lib/supabase/database.types";

/**
 * The org's live rooms, default first. Creates the default room on first visit
 * so a firm never lands on an empty screen with nothing to click. Archived rooms
 * are excluded — they keep their history but leave the switcher.
 */
async function selectRooms(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  orgId: string,
): Promise<DataRoom[]> {
  const { data } = await supabase
    .from("data_rooms")
    .select("*")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  return (data ?? []) as DataRoom[];
}

export async function listRooms(orgId: string): Promise<DataRoom[]> {
  const supabase = await createServerClient();
  const rooms = await selectRooms(supabase, orgId);
  if (rooms.length > 0) return rooms;

  const ctx = await getSessionContext();
  const { data: created } = await supabase
    .from("data_rooms")
    .insert({
      organization_id: orgId,
      name: DEFAULT_ROOM_NAME,
      is_default: true,
      created_by: ctx?.userId ?? null,
    })
    .select("*")
    .maybeSingle();
  if (created) return [created as DataRoom];

  // The insert can fail for two ordinary reasons, and neither is an error the
  // operator should see as a dead end: a reader-role member is refused by the
  // write policy, and two first visits at once race the one-default-per-org
  // unique index. Re-read either way — the racing request may have just
  // created the room this one needs.
  return selectRooms(supabase, orgId);
}

/** The room to show: the requested one when it belongs to the org, else the default. */
export function pickRoom(rooms: DataRoom[], requestedId?: string): DataRoom | null {
  if (rooms.length === 0) return null;
  if (requestedId) {
    const match = rooms.find((r) => r.id === requestedId);
    if (match) return match;
  }
  return rooms.find((r) => r.is_default) ?? rooms[0];
}

/**
 * The documents published into a room, as the room's own view of them: the
 * manifest supplies membership and order, `documents` supplies the content.
 */
export async function loadRoomDocuments(orgId: string, roomId: string): Promise<RoomDocument[]> {
  const supabase = await createServerClient();
  const { data: manifest } = await supabase
    .from("data_room_documents")
    .select("document_id, sort_order")
    .eq("organization_id", orgId)
    .eq("room_id", roomId)
    .order("sort_order", { ascending: true });
  const rows = (manifest ?? []) as { document_id: string; sort_order: number }[];
  if (rows.length === 0) return [];

  const { data: docRows } = await supabase
    .from("documents")
    .select("*")
    .eq("organization_id", orgId)
    .in("id", rows.map((r) => r.document_id));
  const byId = new Map(((docRows ?? []) as Document[]).map((d) => [d.id, d]));

  return rows.flatMap((r) => {
    const d = byId.get(r.document_id);
    if (!d) return [];
    return [
      {
        id: d.id,
        name: d.name,
        section: d.doc_type ?? "other",
        status: d.status ?? "ready",
        sortOrder: r.sort_order ?? 0,
        storageKey: d.storage_key ?? null,
        hasContent: Boolean(d.content && d.content.trim()),
      } satisfies RoomDocument,
    ];
  });
}

/** Map of document id → ids of the rooms it is published into. */
export async function publishedRoomsByDocument(orgId: string): Promise<Map<string, string[]>> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("data_room_documents")
    .select("document_id, room_id")
    .eq("organization_id", orgId);
  const out = new Map<string, string[]>();
  for (const r of (data ?? []) as { document_id: string; room_id: string }[]) {
    const list = out.get(r.document_id);
    if (list) list.push(r.room_id);
    else out.set(r.document_id, [r.room_id]);
  }
  return out;
}
