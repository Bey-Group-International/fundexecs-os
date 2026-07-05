import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { MeetingLobby } from "./MeetingLobby";
import { PastMeetingsList } from "./PastMeetingsList";
import { UpcomingMeetingsList, type UpcomingMeeting } from "./UpcomingMeetingsList";

export const metadata: Metadata = {
  title: "Meeting — FundExecs OS",
  description: "Real-time video meetings with AI transcription, live notes, and action items.",
};

export const dynamic = "force-dynamic";

interface LiveMeeting {
  id: string;
  room_code: string;
  title: string;
  description: string | null;
  location: string | null;
  meeting_url: string | null;
  status: "waiting" | "active" | "ended";
  host_id: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  timezone: string | null;
  meeting_type: string | null;
  priority: "low" | "normal" | "high" | "critical" | null;
  tags: string[] | null;
  attendees: Array<{ name: string; email?: string; type?: "internal" | "external" }> | null;
  source: string | null;
  sync_status: string | null;
  source_event_id: string | null;
  source_calendar_id: string | null;
  deal_id: string | null;
  related_contact_id: string | null;
  related_company_id: string | null;
  related_fund_id: string | null;
}

const MEETING_SELECT =
  "id, room_code, title, description, location, meeting_url, status, host_id, created_at, started_at, ended_at, scheduled_at, duration_minutes, timezone, meeting_type, priority, tags, attendees, source, sync_status, source_event_id, source_calendar_id, deal_id, related_contact_id, related_company_id, related_fund_id";

async function getMeetings(orgId: string, userId: string): Promise<LiveMeeting[]> {
  const supabase = await createServerClient();

  const { data: hosted } = await supabase
    .from("live_meetings")
    .select(MEETING_SELECT)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: participantRows } = await supabase
    .from("live_meeting_participants")
    .select("meeting_id")
    .eq("user_id", userId);

  const participantMeetingIds = (participantRows ?? []).map((r: { meeting_id: string }) => r.meeting_id);

  let participated: LiveMeeting[] = [];
  if (participantMeetingIds.length > 0) {
    const hostedIds = (hosted ?? []).map((m: { id: string }) => m.id);
    const nonHostedIds = participantMeetingIds.filter((id: string) => !hostedIds.includes(id));
    if (nonHostedIds.length > 0) {
      const { data } = await supabase
        .from("live_meetings")
            .select(MEETING_SELECT)
        .in("id", nonHostedIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10);
      participated = (data ?? []) as LiveMeeting[];
    }
  }

  const all = [...(hosted ?? []), ...participated] as LiveMeeting[];
  all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return all.slice(0, 50);
}

export default async function MeetingsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const userId = ctx.userId;
  const meetings = await getMeetings(ctx.orgId, userId);
  const now = Date.now();
  const upcoming = meetings
    .filter((m) => m.scheduled_at && new Date(m.scheduled_at).getTime() >= now && m.status !== "ended")
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const past = meetings.filter((m) => !upcoming.some((u) => u.id === m.id));

  return (
    <div className="flex flex-col gap-10">
      <MeetingLobby />
      <UpcomingMeetingsList initialMeetings={upcoming as unknown as UpcomingMeeting[]} />
      <PastMeetingsList initialMeetings={past} userId={userId} />
    </div>
  );
}
