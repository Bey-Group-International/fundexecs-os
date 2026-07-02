"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

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

      {/* Schedule button */}
      <button
        type="button"
        onClick={() => setScheduleOpen(true)}
        className="flex items-center gap-2 text-sm text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors"
      >
        <CalendarIcon />
        Schedule a meeting
      </button>

      {scheduleOpen && <ScheduleModal onClose={() => setScheduleOpen(false)} />}

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

function ScheduleModal({ onClose }: { onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Default datetime: next hour
  const defaultStart = (() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    // Format for datetime-local: "YYYY-MM-DDTHH:mm"
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  })();

  const [schedTitle, setSchedTitle] = useState("Meeting");
  const [startDatetime, setStartDatetime] = useState(defaultStart);
  const [duration, setDuration] = useState("60");
  const [loading, setLoading] = useState(false);
  const [schedError, setSchedError] = useState<string | null>(null);

  // Close on overlay click
  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    setSchedError(null);
    if (!startDatetime) {
      setSchedError("Please pick a date and time.");
      return;
    }
    setLoading(true);
    try {
      const startIso = new Date(startDatetime).toISOString();
      const roomCode = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
      const params = new URLSearchParams({
        title: schedTitle.trim() || "Meeting",
        startIso,
        durationMinutes: duration,
        roomCode,
      });
      const res = await fetch(`/api/meetings/calendar-link?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to build calendar link");
      const data = await res.json() as { url: string };
      window.open(data.url, "_blank", "noopener,noreferrer");
      onClose();
    } catch (err) {
      setSchedError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
          <div className="flex items-center gap-2 text-[var(--fg-primary)]">
            <CalendarIcon />
            <span className="text-sm font-semibold">Schedule a meeting</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSchedule} className="flex flex-col gap-4 p-5">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--fg-secondary)]">Meeting title</label>
            <input
              type="text"
              value={schedTitle}
              onChange={(e) => setSchedTitle(e.target.value)}
              placeholder="e.g. Q3 LP Review"
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
            />
          </div>

          {/* Date & time */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--fg-secondary)]">Date &amp; time</label>
            <input
              type="datetime-local"
              value={startDatetime}
              onChange={(e) => setStartDatetime(e.target.value)}
              required
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
            />
          </div>

          {/* Duration */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--fg-secondary)]">Duration</label>
            <div className="flex gap-2">
              {[
                { value: "30", label: "30 min" },
                { value: "60", label: "60 min" },
                { value: "90", label: "90 min" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDuration(opt.value)}
                  className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
                    duration === opt.value
                      ? "border-[var(--gold-400)] bg-[var(--gold-400)]/10 text-[var(--gold-400)]"
                      : "border-[var(--line)] bg-[var(--surface-0)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {schedError && (
            <p className="text-xs text-[var(--status-danger)] bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/20 rounded-lg px-3 py-2">
              {schedError}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold py-2.5 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <><SpinnerIcon /> Opening calendar…</>
            ) : (
              <><CalendarIcon /> Schedule &amp; open in Google Calendar</>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
