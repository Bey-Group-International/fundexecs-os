"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { nextChannelName } from "./hooks";

export interface PastMeeting {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "active" | "ended";
  host_id: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
}

type LiveMeeting = PastMeeting;

interface Props {
  initialMeetings: LiveMeeting[];
  userId: string;
  /** Rail variant: drop the centered max-width wrapper and tighten spacing. */
  compact?: boolean;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit",
  });
}

function getDuration(started_at: string | null, ended_at: string | null) {
  if (!started_at || !ended_at) return null;
  const mins = Math.round(
    (new Date(ended_at).getTime() - new Date(started_at).getTime()) / 60000
  );
  return `${mins} min`;
}

const STATUS_STYLES: Record<string, string> = {
  ended:   "bg-[var(--fg-muted)]/10 text-[var(--fg-muted)]",
  active:  "bg-green-500/10 text-green-500",
  waiting: "bg-yellow-500/10 text-yellow-500",
};

// Inline confirm popover for destructive actions
function ConfirmDelete({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-[var(--fg-muted)]">{label}</span>
      <button
        onClick={onConfirm}
        className="px-2 py-0.5 rounded bg-[var(--status-danger)]/15 text-[var(--status-danger)] hover:bg-[var(--status-danger)]/25 font-medium"
      >
        Yes, delete
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-0.5 rounded bg-[var(--surface-2)] text-[var(--fg-secondary)] hover:bg-[var(--surface-3)] font-medium"
      >
        Cancel
      </button>
    </div>
  );
}

function CopyRoomCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }
  return (
    <button
      onClick={copy}
      className="font-mono text-xs text-[var(--fg-secondary)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] px-2 py-0.5 rounded transition-colors"
      title="Copy room code"
    >
      {copied ? "Copied!" : code}
    </button>
  );
}

export function PastMeetingsList({ initialMeetings, userId, compact = false }: Props) {
  const [meetings, setMeetings] = useState<LiveMeeting[]>(initialMeetings);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());
  const [channelName] = useState(() => nextChannelName("past-meetings"));

  // Live updates
  useEffect(() => {
    const supabase = supabaseRef.current;

    async function refresh() {
      const { data: hosted } = await supabase
        .from("live_meetings")
        .select("id, room_code, title, status, host_id, created_at, started_at, ended_at, scheduled_at, duration_minutes")
        .eq("host_id", userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10);

      const { data: participantRows } = await supabase
        .from("live_meeting_participants")
        .select("meeting_id")
        .eq("user_id", userId);

      const participantIds = (participantRows ?? []).map((r: { meeting_id: string }) => r.meeting_id);
      let participated: LiveMeeting[] = [];
      if (participantIds.length > 0) {
        const hostedIds = (hosted ?? []).map((m: { id: string }) => m.id);
        const nonHostedIds = participantIds.filter((id: string) => !hostedIds.includes(id));
        if (nonHostedIds.length > 0) {
          const { data } = await supabase
            .from("live_meetings")
            .select("id, room_code, title, status, host_id, created_at, started_at, ended_at, scheduled_at, duration_minutes")
            .in("id", nonHostedIds)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(10);
          participated = (data ?? []) as LiveMeeting[];
        }
      }

      const all = [...(hosted ?? []), ...participated] as LiveMeeting[];
      all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setMeetings(all.slice(0, 10));
    }

    // Reconcile on mount so the client's user-scoped view replaces the org-wide
    // SSR snapshot immediately (matching UpcomingMeetingsList) — otherwise the
    // initial list showed other members' meetings until an unrelated realtime
    // event happened to fire and narrow it.
    void refresh();

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_meetings" },
        () => { void refresh(); }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [userId, channelName]);

  async function softHide(id: string) {
    setBusy(id);
    await fetch("/api/meetings/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId: id, soft: true }),
    });
    setMeetings((prev) => prev.filter((m) => m.id !== id));
    setBusy(null);
  }

  async function hardDelete(id: string) {
    setBusy(id);
    setConfirmDelete(null);
    await fetch("/api/meetings/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId: id }),
    });
    setMeetings((prev) => prev.filter((m) => m.id !== id));
    setBusy(null);
  }

  async function clearAll(soft: boolean) {
    setBusy("__all__");
    setConfirmClearAll(false);
    await fetch("/api/meetings/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearAll: true, soft }),
    });
    setMeetings((prev) => prev.filter((m) => m.host_id !== userId));
    setBusy(null);
  }

  const hostedMeetings = meetings.filter((m) => m.host_id === userId);

  return (
    <section className={compact ? "w-full" : "max-w-2xl mx-auto w-full px-4"}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[var(--fg-secondary)] uppercase tracking-wider">
          Past meetings
        </h2>
        {hostedMeetings.length > 0 && (
          <div className="flex items-center gap-2">
            {confirmClearAll ? (
              <ConfirmDelete
                label="Remove all your meetings?"
                onConfirm={() => void clearAll(false)}
                onCancel={() => setConfirmClearAll(false)}
              />
            ) : (
              <button
                onClick={() => setConfirmClearAll(true)}
                disabled={busy === "__all__"}
                className="text-xs text-[var(--fg-muted)] hover:text-[var(--status-danger)] transition-colors disabled:opacity-40"
              >
                {busy === "__all__" ? "Clearing…" : "Clear all"}
              </button>
            )}
          </div>
        )}
      </div>

      {meetings.length === 0 ? (
        <p className="text-sm text-[var(--fg-muted)] py-4">No past meetings yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
          {meetings.map((m) => {
            const isHost = m.host_id === userId;
            const duration = getDuration(m.started_at, m.ended_at);
            const isExpanded = expanded === m.id;
            const isActive = m.status === "active" || m.status === "waiting";

            return (
              <li key={m.id} className="flex flex-col py-3.5 sm:py-3 gap-2">
                {/* Row */}
                <div className="flex items-center justify-between gap-3">
                  {/* Left: title + meta — full row is tappable for active meetings */}
                  <button
                    className="flex flex-col gap-0.5 min-w-0 text-left flex-1 py-0.5"
                    onClick={() =>
                      isActive
                        ? setExpanded(isExpanded ? null : m.id)
                        : undefined
                    }
                    style={{ cursor: isActive ? "pointer" : "default" }}
                  >
                    <span className="text-sm font-medium text-[var(--fg-primary)] truncate">
                      {m.title}
                    </span>
                    <span className="text-xs text-[var(--fg-muted)]">
                      {formatDate(m.created_at)}
                      {duration ? ` · ${duration}` : ""}
                    </span>
                  </button>

                  {/* Right: status + actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* On mobile: show Rejoin/Report links directly for active/ended meetings */}
                    {isActive && (
                      <Link
                        href={`/meetings/${m.room_code}`}
                        className="sm:hidden text-xs font-semibold text-[var(--gold-400)] bg-[var(--gold-400)]/10 px-2.5 py-1 rounded-lg hover:bg-[var(--gold-400)]/20 transition-colors"
                      >
                        {m.status === "active" ? "Rejoin" : "Start"}
                      </Link>
                    )}

                    <button
                      onClick={() =>
                        isActive ? setExpanded(isExpanded ? null : m.id) : undefined
                      }
                      style={{ cursor: isActive ? "pointer" : "default" }}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                        STATUS_STYLES[m.status] ?? STATUS_STYLES.waiting
                      }`}
                    >
                      {isActive && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full inline-block ${
                            m.status === "active" ? "bg-green-500 animate-pulse" : "bg-yellow-500"
                          }`}
                        />
                      )}
                      {m.status === "waiting"
                        ? "Waiting"
                        : m.status === "active"
                        ? "Live"
                        : "Ended"}
                      {isActive && <span className="hidden sm:inline text-[0.6rem] opacity-60">▾</span>}
                    </button>

                    {m.status === "ended" && (
                      <Link
                        href={`/meetings/${m.room_code}/report`}
                        className="text-xs text-[var(--gold-400)] hover:underline whitespace-nowrap"
                      >
                        View report →
                      </Link>
                    )}

                    {isHost && confirmDelete === m.id ? (
                      <ConfirmDelete
                        label="Delete?"
                        onConfirm={() => void hardDelete(m.id)}
                        onCancel={() => setConfirmDelete(null)}
                      />
                    ) : isHost ? (
                      <div className="flex items-center gap-1.5">
                        {/* Soft hide */}
                        <button
                          onClick={() => void softHide(m.id)}
                          disabled={busy === m.id}
                          className="text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] transition-colors disabled:opacity-40"
                          title="Hide from list"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        </button>
                        {/* Hard delete */}
                        <button
                          onClick={() => setConfirmDelete(m.id)}
                          disabled={busy === m.id}
                          className="text-[var(--fg-muted)] hover:text-[var(--status-danger)] transition-colors disabled:opacity-40"
                          title="Delete permanently"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4h6v2" />
                          </svg>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Expandable detail panel for waiting / active meetings */}
                {isExpanded && isActive && (
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-3 flex flex-col gap-3 ml-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[0.65rem] text-[var(--fg-muted)] uppercase tracking-wide font-medium">
                          Room code
                        </span>
                        <CopyRoomCode code={m.room_code} />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[0.65rem] text-[var(--fg-muted)] uppercase tracking-wide font-medium">
                          Started
                        </span>
                        <span className="text-xs text-[var(--fg-secondary)]">
                          {m.started_at
                            ? `${formatDate(m.started_at)} at ${formatTime(m.started_at)}`
                            : `Created ${formatTime(m.created_at)}`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Link
                        href={`/meetings/${m.room_code}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--gold-400)] text-black text-xs font-semibold px-3 py-1.5 hover:opacity-90 transition-opacity"
                      >
                        {isHost && m.status === "waiting" ? "Start meeting" : "Rejoin meeting"}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M15 10l5 5-5 5" /><path d="M4 4v7a4 4 0 0 0 4 4h12" />
                        </svg>
                      </Link>
                      <span className="text-xs text-[var(--fg-muted)]">
                        {m.status === "active" ? "Meeting is live" : "Waiting for participants"}
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
