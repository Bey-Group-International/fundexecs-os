// lib/session-messages.ts
// Read + map persisted conversational turns for a session. The composer renders
// chat turns from these on load, so Earn's answers survive a reload. Keeping the
// row→turn mapping pure makes it unit-testable; the DB read is best-effort so a
// failure (or a deploy before the table exists) degrades to an empty transcript
// rather than throwing.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SessionMessage } from "@/lib/supabase/database.types";

// The shape the composer seeds its chat state from. `ts` lets the transcript
// interleave chat and workflow turns by time.
export interface ChatTurnSeed {
  id: string;
  role: "you" | "earn";
  content: string;
  ts: number;
}

export function toChatTurns(
  rows: Pick<SessionMessage, "id" | "role" | "content" | "created_at">[],
): ChatTurnSeed[] {
  return rows.map((r) => ({
    id: r.id,
    role: r.role === "assistant" ? "earn" : "you",
    content: r.content,
    ts: Date.parse(r.created_at) || 0,
  }));
}

export async function loadSessionMessages(
  supabase: SupabaseClient<Database>,
  sessionId: string,
): Promise<SessionMessage[]> {
  const { data, error } = await supabase
    .from("session_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data;
}

/** A turn id that came from the database (a uuid) rather than a client-minted one. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPersistedTurnId(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * Rewrite one persisted turn. Turns created in the current session carry a
 * client-minted id (no row to address yet), so the caller may instead pass the
 * exact text it is replacing and we match on that within the session. Returns
 * how many rows were rewritten; 0 is not an error — the transcript in front of
 * the operator is still updated, it simply had nothing persisted behind it.
 */
export async function updateSessionMessage(
  supabase: SupabaseClient<Database>,
  args: { sessionId: string; turnId: string; previousContent: string; content: string },
): Promise<number> {
  const query = supabase
    .from("session_messages")
    .update({ content: args.content })
    .eq("session_id", args.sessionId);
  const { data, error } = await (isPersistedTurnId(args.turnId)
    ? query.eq("id", args.turnId)
    : query.eq("content", args.previousContent)
  ).select("id");
  if (error || !data) return 0;
  return data.length;
}

/**
 * Delete one persisted turn, addressed the same way as `updateSessionMessage`.
 * Returns how many rows were removed.
 */
export async function deleteSessionMessage(
  supabase: SupabaseClient<Database>,
  args: { sessionId: string; turnId: string; content: string },
): Promise<number> {
  const query = supabase.from("session_messages").delete().eq("session_id", args.sessionId);
  const { data, error } = await (isPersistedTurnId(args.turnId)
    ? query.eq("id", args.turnId)
    : query.eq("content", args.content)
  ).select("id");
  if (error || !data) return 0;
  return data.length;
}
