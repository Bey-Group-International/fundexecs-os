"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MeetingEditScreen } from "./MeetingEditScreen";

/**
 * The one action bar at the top of Meetings: start a meeting, or join one by
 * code. This used to be a marketing hero — headline, blurb, capability strip
 * and a decorative graphic — which is the wrong shape for a page a member
 * opens every day. The meetings themselves are the content; this is the
 * toolbar above them.
 */
export function MeetingLobby({ onScheduleLater }: { onScheduleLater?: () => void } = {}) {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the "New meeting" menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function startInstant() {
    setMenuOpen(false);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/meetings/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Meeting" }),
        });
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? "Failed to create meeting");
        }
        const data = (await res.json()) as { id: string; roomCode: string };
        router.push(`/meetings/${data.roomCode}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create meeting");
      }
    });
  }

  function openCalendar() {
    setMenuOpen(false);
    // On the Meetings page this opens the full calendar overlay — the single
    // entry point to it, now that the scheduling card no longer duplicates the
    // door. Falls back to the inline schedule form when used standalone.
    if (onScheduleLater) onScheduleLater();
    else setScheduleOpen(true);
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toLowerCase().replace(/\s/g, "");
    if (!code) return;
    setError(null);
    router.push(`/meetings/${code}`);
  }

  return (
    <div className="px-4 pt-4 sm:pt-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              disabled={isPending}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--gold-400)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--gold-500)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isPending ? <SpinnerIcon /> : <VideoIcon />}
              {isPending ? "Starting…" : "New meeting"}
              <CaretIcon />
            </button>

            {menuOpen ? (
              <div
                role="menu"
                className="absolute left-0 top-full z-20 mt-2 w-64 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-1)] shadow-2xl"
              >
                <MenuItem
                  icon={<BoltIcon />}
                  title="Start an instant meeting"
                  subtitle="Create a room and join now"
                  onClick={startInstant}
                />
                <div className="h-px bg-[var(--line)]" />
                <MenuItem
                  icon={<CalendarIcon />}
                  title="Schedule for later"
                  subtitle="Open the calendar to pick a time"
                  onClick={openCalendar}
                />
              </div>
            ) : null}
          </div>

          {/* Code entry */}
          <form onSubmit={handleJoin} className="flex flex-1 items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 focus-within:ring-2 focus-within:ring-[var(--gold-400)]">
              <KeyboardIcon />
              <input
                type="text"
                aria-label="Meeting code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Enter a meeting code"
                className="w-full bg-transparent text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={!joinCode.trim()}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                joinCode.trim()
                  ? "text-[var(--gold-400)] hover:bg-[var(--gold-400)]/10"
                  : "cursor-not-allowed text-[var(--fg-muted)]"
              }`}
            >
              Join
            </button>
          </form>
        </div>

        {error ? <ErrorMsg msg={error} /> : null}
      </div>

      {scheduleOpen ? (
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
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)]"
    >
      <span className="mt-0.5 text-[var(--gold-400)]">{icon}</span>
      <span className="flex flex-col">
        <span className="text-sm font-medium text-[var(--fg-primary)]">{title}</span>
        <span className="text-xs text-[var(--fg-muted)]">{subtitle}</span>
      </span>
    </button>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <p className="w-fit rounded-lg border border-[var(--status-danger)]/20 bg-[var(--status-danger)]/10 px-3 py-2 text-xs text-[var(--status-danger)]">
      {msg}
    </p>
  );
}

function VideoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function CaretIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" ry="2" />
      <line x1="6" y1="10" x2="6" y2="10" /><line x1="10" y1="10" x2="10" y2="10" /><line x1="14" y1="10" x2="14" y2="10" /><line x1="18" y1="10" x2="18" y2="10" />
      <line x1="7" y1="14" x2="17" y2="14" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

