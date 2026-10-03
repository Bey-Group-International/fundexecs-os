// lib/meetings/prompt-meeting.server.ts
// Which meeting a prompt was sent from, when it was sent from a meeting page.
//
// The client passes the room code it is looking at (never an id it could have
// made up); this resolves it inside the caller's organisation, through the
// caller's own client, so a prompt can only ever be tied to a meeting its
// sender can see. Anything else — no code, a malformed one, a meeting in
// another org — resolves to null and the task is created exactly as before.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

import { ROOM_CODE } from "@/lib/meetings/prompt-meeting";

export async function meetingIdForRoom(
  supabase: SupabaseClient<Database>,
  orgId: string,
  roomCode: unknown,
): Promise<string | null> {
  if (typeof roomCode !== "string" || !ROOM_CODE.test(roomCode)) return null;
  try {
    const { data } = await supabase
      .from("live_meetings")
      .select("id")
      .eq("organization_id", orgId)
      .eq("room_code", roomCode)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}
