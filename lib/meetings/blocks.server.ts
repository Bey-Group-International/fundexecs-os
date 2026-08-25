// lib/meetings/blocks.server.ts
// Reading blocked time for the internal conflict check. Split from blocks.ts so
// the rules there stay pure and directly testable; only the query lives here.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SchedulingBlock } from "@/lib/supabase/database.types";
import { MAX_BLOCK_MINUTES, findBlockConflicts, type BlockConflict } from "@/lib/meetings/blocks";

type Client = SupabaseClient<Database>;

/**
 * The acting member's blocks overlapping a proposed meeting.
 *
 * Only their own: a block is personal, and warning someone that a colleague is
 * busy would both leak that colleague's private label and fire constantly. RLS
 * enforces this too — the explicit filter is here so the intent is legible.
 *
 * Never throws. A failed read means the warning is missed, which is a far
 * smaller harm than refusing to save the meeting.
 */
export async function loadBlockConflicts(
  supabase: Client,
  userId: string,
  startIso: string,
  endIso: string,
): Promise<BlockConflict[]> {
  try {
    // A block starting before the window can still run into it. Blocks are
    // capped at MAX_BLOCK_MINUTES, so looking back that far is enough to catch
    // every overlap while keeping the scan bounded.
    const lookback = new Date(new Date(startIso).getTime() - MAX_BLOCK_MINUTES * 60_000).toISOString();
    const { data, error } = await supabase
      .from("scheduling_blocks")
      .select("id, title, starts_at, ends_at")
      .eq("user_id", userId)
      .gte("starts_at", lookback)
      .lt("starts_at", endIso)
      .order("starts_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return findBlockConflicts(
      (data ?? []) as unknown as Array<Pick<SchedulingBlock, "id" | "title" | "starts_at" | "ends_at">>,
      startIso,
      endIso,
    );
  } catch (err) {
    console.error("[blocks] conflict lookup failed", err);
    return [];
  }
}
