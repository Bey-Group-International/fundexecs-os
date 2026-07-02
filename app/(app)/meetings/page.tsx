import { Metadata } from "next";
import { createServerClient } from "@/lib/supabase/server";
import { MeetingLobby } from "./MeetingLobby";
import { PastMeetingsList } from "./PastMeetingsList";

export const metadata: Metadata = {
  title: "Meeting — FundExecs OS",
  description: "Real-time video meetings with AI transcription, live notes, and action items.",
};

interface LiveMeeting {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "active" | "ended";
  host_id: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

async function getPastMeetings(userId: string): Promise<LiveMeeting[]> {
  const supabase = createServerClient();

  const { data: hosted } = await supabase
    .from("live_meetings")
    .select("id, room_code, title, status, host_id, created_at, started_at, ended_at")
    .eq("host_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: participantRows } = await supabase
    .from("live_meeting_participants")
    .select("meeting_id")
    .eq("user_id", userId);

  const participantMeetingIds = (participantRows ?? []).map((r: { meeting_id: string }) => r.meeting_id);

  let participated: LiveMeeting[] = [];
  if (participantMeetingIds.length > 0) {
    const hostedIds = (hosted ?? []).map((m: LiveMeeting) => m.id);
    const nonHostedIds = participantMeetingIds.filter((id: string) => !hostedIds.includes(id));
    if (nonHostedIds.length > 0) {
      const { data } = await supabase
        .from("live_meetings")
        .select("id, room_code, title, status, host_id, created_at, started_at, ended_at")
        .in("id", nonHostedIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10);
      participated = (data ?? []) as LiveMeeting[];
    }
  }

  const all = [...(hosted ?? []), ...participated] as LiveMeeting[];
  all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return all.slice(0, 10);
}

export default async function MeetingsPage() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? "";
  const meetings = userId ? await getPastMeetings(userId) : [];

  return (
    <div className="flex flex-col gap-10">
      <MeetingLobby />
      <PastMeetingsList initialMeetings={meetings} userId={userId} />
    </div>
  );
}
