"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MeetingEditScreen } from "./MeetingEditScreen";

export function MeetingLobby() {
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [title, setTitle] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [scheduleOpen, setScheduleOpen] = useState(false);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/meetings/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim() || "Meeting" }),
        });
        if (!res.ok) {
          const err = await res.json() as { error?: string };
          throw new Error(err.error ?? "Failed to create meeting");
        }
        const data = await res.json() as { id: string; roomCode: string };
        router.push(`/meetings/${data.roomCode}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create meeting");
      }
    });
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toLowerCase().replace(/\s/g, "");
    if (!code) return;
    setError(null);
    router.push(`/meetings/${code}`);
  }

  return (
    <div className="flex flex-col items-center gap-5 sm:gap-8 px-4 pt-6 sm:pt-0 sm:justify-center sm:min-h-[60vh]">
      {/* Hero — compact on mobile */}
      <div className="text-center flex flex-col gap-1.5 sm:gap-2">
        <div className="inline-flex items-center justify-center w-11 h-11 sm:w-14 sm:h-14 rounded-2xl bg-[var(--gold-400)]/10 border border-[var(--gold-400)]/20 mb-1 sm:mb-2 mx-auto">
          <VideoIcon />
        </div>
        <h1 className="text-xl sm:text-2xl font-semibold text-[var(--fg-primary)]">Meetings</h1>
        <p className="hidden sm:block text-sm text-[var(--fg-muted)] max-w-sm">
          Institutional-grade video rooms with live transcription, briefing notes, and tracked action items.
        </p>
      </div>

      {/* Card */}
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-[var(--line)]">
          {(["create", "join"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setError(null); }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === t
                  ? "text-[var(--fg-primary)] border-b-2 border-[var(--gold-400)] -mb-px"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
              }`}
            >
              {t === "create" ? "New meeting" : "Join meeting"}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === "create" ? (
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--fg-secondary)]">
                  Meeting title <span className="text-[var(--fg-muted)]">(optional)</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Q3 LP Review"
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
                />
              </div>
              {error && <ErrorMsg msg={error} />}
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold py-2.5 transition-colors flex items-center justify-center gap-2"
              >
                {isPending ? (
                  <><SpinnerIcon /> Starting…</>
                ) : (
                  <><PlusIcon /> Start meeting</>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--fg-secondary)]">
                  Meeting code
                </label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="abc-defg-hij"
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] font-mono tracking-wider text-center"
                />
              </div>
              {error && <ErrorMsg msg={error} />}
              <button
                type="submit"
                disabled={!joinCode.trim()}
                className="rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold py-2.5 transition-colors"
              >
                Join
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Schedule button */}
      <button
        type="button"
        onClick={() => setScheduleOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3.5 py-2 text-sm text-[var(--fg-secondary)] hover:border-[var(--gold-400)]/40 hover:text-[var(--fg-primary)] transition-colors"
      >
        <CalendarIcon />
        Schedule for later
      </button>

      {scheduleOpen && (
        <MeetingEditScreen
          mode="create"
          onClose={() => setScheduleOpen(false)}
          onSaved={() => {
            // Saved (or draft) meetings lock into Upcoming Meetings below; the
            // realtime subscription there refreshes automatically.
            setScheduleOpen(false);
            router.refresh();
          }}
        />
      )}

      {/* Feature list — hidden on mobile to reduce scroll */}
      <div className="hidden sm:grid grid-cols-3 gap-4 w-full max-w-md">
        {[
          { icon: "🎙", label: "Live transcription" },
          { icon: "✨", label: "AI-generated notes" },
          { icon: "✅", label: "Action items" },
        ].map((f) => (
          <div
            key={f.label}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-3 text-center"
          >
            <span className="text-xl">{f.icon}</span>
            <span className="text-xs text-[var(--fg-secondary)]">{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <p className="text-xs text-[var(--status-danger)] bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/20 rounded-lg px-3 py-2">
      {msg}
    </p>
  );
}

function VideoIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--gold-400)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
