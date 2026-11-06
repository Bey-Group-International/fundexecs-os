// lib/meetings/chat-for-report.server.ts
// Reading a meeting's chat for the report model. See chat-for-report.ts.
import { chatForReport, type ChatRowForReport } from "@/lib/meetings/chat-for-report";

/** The most rows read; the formatter trims further to its character budget. */
const CHAT_ROWS = 500;

type ClientLike = { from: (table: string) => any };

/**
 * The chat, formatted for the prompt; empty on any failure. A report without the
 * chat is the report this product made before, and losing the chat must never
 * cost the meeting its report.
 */
export async function loadChatForReport(supabase: ClientLike, meetingId: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("live_meeting_chat")
      .select("author_name, body, ts")
      .eq("meeting_id", meetingId)
      .order("ts", { ascending: true })
      .limit(CHAT_ROWS);
    if (error) return "";
    return chatForReport((data ?? []) as ChatRowForReport[]);
  } catch {
    return "";
  }
}
