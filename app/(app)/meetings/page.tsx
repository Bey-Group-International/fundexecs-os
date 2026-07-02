import { Metadata } from "next";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { MeetingLobby } from "./MeetingLobby";

export const metadata: Metadata = {
  title: "Meeting — FundExecs OS",
  description: "Real-time video meetings with AI transcription, live notes, and action items.",
};

interface LiveMeeting {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "active" | "ended";
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

async function getPastMeetings(): Promise<LiveMeeting[]> {
  const supabase = createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Meetings where user is host
  const { data: hosted } = await supabase
    .from("live_meetings")
    .select("id, room_code, title, status, created_at, started_at, ended_at")
    .eq("host_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  // Meetings where user was a participant (but not host)
  const { data: participantRows } = await supabase
    .from("live_meeting_participants")
    .select("meeting_id")
    .eq("user_id", user.id);

  const participantMeetingIds = (participantRows ?? []).map((r) => r.meeting_id);

  let participated: LiveMeeting[] = [];
  if (participantMeetingIds.length > 0) {
    const hostedIds = (hosted ?? []).map((m) => m.id);
    const nonHostedIds = participantMeetingIds.filter((id) => !hostedIds.includes(id));
    if (nonHostedIds.length > 0) {
      const { data } = await supabase
        .from("live_meetings")
        .select("id, room_code, title, status, created_at, started_at, ended_at")
        .in("id", nonHostedIds)
        .order("created_at", { ascending: false })
        .limit(10);
      participated = (data ?? []) as LiveMeeting[];
    }
  }

  const all = [...(hosted ?? []), ...participated] as LiveMeeting[];
  // Sort combined list and take top 10
  all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return all.slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDuration(started_at: string | null, ended_at: string | null): string | null {
  if (!started_at || !ended_at) return null;
  const mins = Math.round(
    (new Date(ended_at).getTime() - new Date(started_at).getTime()) / 60000
  );
  return `${mins} min`;
}

const STATUS_STYLES: Record<string, string> = {
  ended: "bg-[var(--fg-muted)]/10 text-[var(--fg-muted)]",
  active: "bg-green-500/10 text-green-500",
  waiting: "bg-yellow-500/10 text-yellow-500",
};

export default async function MeetingsPage() {
  const meetings = await getPastMeetings();

  return (
    <div className="flex flex-col gap-10">
      <MeetingLobby />

      {/* Past meetings */}
      <section className="max-w-2xl mx-auto w-full px-4">
        <h2 className="text-sm font-semibold text-[var(--fg-secondary)] uppercase tracking-wider mb-3">
          Past meetings
        </h2>

        {meetings.length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)] py-4">
            No past meetings yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
            {meetings.map((m) => {
              const duration = getDuration(m.started_at, m.ended_at);
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium text-[var(--fg-primary)] truncate">
                      {m.title}
                    </span>
                    <span className="text-xs text-[var(--fg-muted)]">
                      {formatDate(m.created_at)}
                      {duration ? ` · ${duration}` : ""}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        STATUS_STYLES[m.status] ?? STATUS_STYLES.waiting
                      }`}
                    >
                      {m.status}
                    </span>
                    {m.status === "ended" && (
                      <Link
                        href={`/meetings/${m.room_code}/report`}
                        className="text-xs text-[var(--gold-400)] hover:underline"
                      >
                        View report →
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
