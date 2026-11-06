// lib/meetings/meeting-brief.server.ts
// Reading a meeting's brief for the report model. See meeting-brief.ts.
import { meetingBrief, type MeetingBriefRow } from "@/lib/meetings/meeting-brief";

type ClientLike = { from: (table: string) => any };

/**
 * The brief, formatted for the prompt; empty on any failure. A report without
 * it is the report this product made before, and losing it must never cost the
 * meeting its report.
 */
export async function loadMeetingBrief(supabase: ClientLike, meetingId: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("live_meetings")
      .select("objective, agenda, description")
      .eq("id", meetingId)
      .maybeSingle();
    if (error) return "";
    return meetingBrief(data as MeetingBriefRow | null);
  } catch {
    return "";
  }
}
