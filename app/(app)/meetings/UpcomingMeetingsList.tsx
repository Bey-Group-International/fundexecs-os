"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export interface UpcomingMeeting {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "active" | "ended";
  scheduled_at: string | null;
  duration_minutes: number | null;
}

function formatScheduled(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function UpcomingMeetingsList({ initialMeetings }: { initialMeetings: UpcomingMeeting[] }) {
  const [meetings, setMeetings] = useState(initialMeetings);

  useEffect(() => {
    const supabase = createClient();
    async function refresh() {
      const { data } = await supabase
        .from("live_meetings")
        .select("id, room_code, title, status, scheduled_at, duration_minutes")
        .neq("status", "ended")
        .gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(25);
      if (data) setMeetings(data as UpcomingMeeting[]);
    }
    void refresh();

    const channel = supabase
      .channel("upcoming-meetings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_meetings" }, () => {
        void refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  if (meetings.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-2xl px-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
          Upcoming meetings
        </h2>
        <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--fg-muted)]">
          Native calendar
        </span>
      </div>
      <div className="grid gap-2">
        {meetings.map((meeting) => (
          <Link
            key={meeting.id}
            href={`/meetings/${meeting.room_code}`}
            className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 transition hover:border-[var(--gold-400)]/50"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--fg-primary)]">{meeting.title}</p>
                <p className="mt-1 text-xs text-[var(--fg-muted)]">
                  {meeting.scheduled_at ? formatScheduled(meeting.scheduled_at) : "Time TBD"}
                  {meeting.duration_minutes ? ` · ${meeting.duration_minutes} min` : ""}
                </p>
              </div>
              <span className="rounded-full bg-[var(--gold-400)]/10 px-2 py-0.5 text-xs font-medium text-[var(--gold-400)]">
                Join →
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
