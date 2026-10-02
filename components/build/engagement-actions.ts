"use server";

// Earn's read of investor engagement in a room. Asked for from the activity
// view; stored so the page shows it without a model call on every load.
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { canWriteOrg } from "@/lib/rbac";
import { createServerClient } from "@/lib/supabase/server";
import { refreshRoomReads } from "@/lib/data-room-engagement.server";

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

  const res = await refreshRoomReads(supabase, ctx.orgId, room as { id: string; name: string });
  if (!res.ok) return { ok: false, error: "Couldn't save Earn's read. Try again." };
  revalidatePath("/build/data_room");
  return { ok: true, count: res.count };
}
