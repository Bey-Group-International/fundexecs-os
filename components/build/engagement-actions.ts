"use server";

// Earn's read of investor engagement in a room. Asked for from the activity
// view; stored so the page shows it without a model call on every load.
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { canWriteOrg } from "@/lib/rbac";
import { createServerClient } from "@/lib/supabase/server";
import { loadRoomEngagement, readEngagement } from "@/lib/data-room-engagement.server";

export async function refreshEngagementReads(roomId: string): Promise<{ ok: boolean; error?: string; count?: number }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Sign in again to ask Earn." };
  if (!canWriteOrg(ctx.role)) return { ok: false, error: "Your role is view-only. Ask an owner or admin to run this." };
  if (typeof roomId !== "string" || !roomId) return { ok: false, error: "No room." };

  const supabase = await createServerClient();
  const { data: room } = await supabase
    .from("data_rooms")
    .select("id, name")
    .eq("id", roomId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!room) return { ok: false, error: "That room is not in this workspace." };

  const { engagement } = await loadRoomEngagement(supabase, ctx.orgId, roomId);
  if (engagement.investors.length === 0) return { ok: true, count: 0 };

  const reads = await readEngagement(engagement.investors, {
    roomName: (room as { name: string }).name,
    today: new Date().toISOString().slice(0, 10),
  });
  const lastSeen = new Map(engagement.investors.map((a) => [a.key, a.lastSeen]));
  const now = new Date().toISOString();
  const { error } = await supabase.from("data_room_engagement_reads").upsert(
    reads.map((r) => ({
      room_id: roomId,
      viewer_key: r.key,
      organization_id: ctx.orgId,
      summary: r.summary,
      signal: r.signal,
      follow_up: r.follow_up,
      source: r.source,
      activity_through: lastSeen.get(r.key) ?? null,
      read_at: now,
    })) as never,
    { onConflict: "room_id,viewer_key" },
  );
  if (error) return { ok: false, error: "Couldn't save Earn's read. Try again." };
  revalidatePath("/build/data_room");
  return { ok: true, count: reads.length };
}
