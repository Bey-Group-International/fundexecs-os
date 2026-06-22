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
