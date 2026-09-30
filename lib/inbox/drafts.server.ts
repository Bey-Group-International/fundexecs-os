// lib/inbox/drafts.server.ts
// Reading and clearing the unsent drafts held against an inbox thread.
//
// Read through the caller's own client so RLS decides what belongs to whom, the
// same way every other inbox read does. Never throws: a draft that cannot be read
// costs a badge, and a board that fails to render costs the inbox.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, InboxThreadDraft } from "@/lib/supabase/database.types";
import { DRAFT_LIMIT, type ThreadDraft } from "@/lib/inbox/drafts";

type Client = SupabaseClient<Database>;

/** Every draft this organisation is holding, by thread id. */
export async function readThreadDrafts(supabase: Client): Promise<Map<string, ThreadDraft>> {
  const out = new Map<string, ThreadDraft>();
  try {
    const { data, error } = await supabase
      .from("inbox_thread_drafts")
      .select("thread_id, body, source, source_meeting_id, updated_at")
      // Newest first, so if the ceiling ever bites it drops the stalest drafts
      // rather than an arbitrary set.
      .order("updated_at", { ascending: false })
      .limit(DRAFT_LIMIT);
    if (error || !data) return out;

    for (const row of data as unknown as InboxThreadDraft[]) {
      out.set(row.thread_id, {
        threadId: row.thread_id,
        body: row.body,
        source: row.source,
        sourceMeetingId: row.source_meeting_id,
        updatedAt: row.updated_at,
      });
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * Clear the draft on a thread.
 *
 * Called after a reply goes out, because a draft of a message that has already
 * been sent is the one state this table must not hold — it would sit in the
 * composer inviting somebody to send it again.
 *
 * Deleted rather than marked, per the table's own shape: nothing reads the history
 * of drafts, and what was actually sent is recorded as an inbox_message.
 *
 * Never throws, and its failure is deliberately not fatal to the send: the reply
 * has already gone, and turning a stale draft into an error the operator sees
 * after a successful send would be worse than the stale draft.
 */
export async function clearThreadDraft(supabase: Client, threadId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("inbox_thread_drafts")
      .delete()
      .eq("thread_id", threadId);
    if (error) {
      console.warn("[inbox/drafts] draft not cleared", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[inbox/drafts] clearing the draft threw", err);
    return false;
  }
}
