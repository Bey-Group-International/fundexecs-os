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
 * Resolve the single row a client-minted turn refers to: the most recent one in
 * the session whose text matches. Matching on content alone would address every
 * repeat of the same question — asking "what changed?" twice and then deleting
 * one of them would silently delete both — so the match is narrowed to one id
 * before anything is written.
 */
async function findRowIdByContent(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  content: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("session_messages")
    .select("id")
    .eq("session_id", sessionId)
    .eq("content", content)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].id;
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
  const id = isPersistedTurnId(args.turnId)
    ? args.turnId
    : await findRowIdByContent(supabase, args.sessionId, args.previousContent);
  if (!id) return 0;
  const { data, error } = await supabase
    .from("session_messages")
    .update({ content: args.content })
    .eq("session_id", args.sessionId)
    .eq("id", id)
    .select("id");
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
  const id = isPersistedTurnId(args.turnId)
    ? args.turnId
    : await findRowIdByContent(supabase, args.sessionId, args.content);
  if (!id) return 0;
  const { data, error } = await supabase
    .from("session_messages")
    .delete()
    .eq("session_id", args.sessionId)
    .eq("id", id)
    .select("id");
  if (error || !data) return 0;
  return data.length;
}
