"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function MeetingLobby() {
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [title, setTitle] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8 px-4">
      {/* Hero */}
      <div className="text-center flex flex-col gap-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--gold-400)]/10 border border-[var(--gold-400)]/20 mb-2 mx-auto">
          <VideoIcon />
        </div>
        <h1 className="text-2xl font-semibold text-[var(--fg-primary)]">Meeting</h1>
        <p className="text-sm text-[var(--fg-muted)] max-w-sm">
          High-quality video meetings with AI-powered transcription, live notes, and action items.
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

      {/* Feature list */}
      <div className="grid grid-cols-3 gap-4 w-full max-w-md">
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
