"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MeetingEditScreen } from "./MeetingEditScreen";

export function MeetingLobby() {
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

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toLowerCase().replace(/\s/g, "");
    if (!code) return;
    setError(null);
    router.push(`/meetings/${code}`);
  }

  return (
    <div className="px-4 pt-4 sm:pt-10">
      <div className="mx-auto grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left column — hero + actions */}
        <div className="flex flex-col gap-7">
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--gold-400)]/25 bg-[var(--gold-400)]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--gold-400)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold-400)]" />
              FundExecs Meetings
            </span>
            <h1 className="text-3xl font-semibold leading-[1.1] tracking-tight text-[var(--fg-primary)] sm:text-[2.75rem]">
              Secure video meetings for your firm
            </h1>
            <p className="max-w-md text-sm text-[var(--fg-muted)] sm:text-base">
              Convene LPs, deal teams, and advisors in institutional-grade rooms — with live transcription,
              briefing notes, and tracked action items.
            </p>
          </div>

          {/* Action row — New meeting dropdown + code entry, Google Meet style */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                disabled={isPending}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--gold-400)] px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-[var(--gold-500)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
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
                    subtitle="Set a time, agenda, and attendees"
                    onClick={() => {
                      setMenuOpen(false);
                      setScheduleOpen(true);
                    }}
                  />
                </div>
              ) : null}
            </div>

            {/* Code entry */}
            <form onSubmit={handleJoin} className="flex flex-1 items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 focus-within:ring-2 focus-within:ring-[var(--gold-400)]">
                <KeyboardIcon />
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Enter a meeting code"
                  className="w-full bg-transparent text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={!joinCode.trim()}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
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

          <div className="h-px w-full bg-[var(--line)]" />

          {/* Capability strip */}
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--fg-muted)]">
            {["Live transcription", "AI-generated notes", "Action items", "Calendar sync"].map((f) => (
              <span key={f} className="inline-flex items-center gap-1.5">
                <CheckIcon />
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Right column — branded graphic */}
        <div className="hidden lg:flex lg:items-center lg:justify-center">
          <LobbyGraphic />
        </div>
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

function LobbyGraphic() {
  // A restrained, on-brand illustration echoing Google Meet's hero graphic:
  // a video-call grid with a gold "connected" link badge. Purely decorative.
  return (
    <svg
      viewBox="0 0 360 300"
      className="w-full max-w-sm"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="180" cy="150" r="140" fill="var(--gold-400)" opacity="0.05" />
      <circle cx="180" cy="150" r="100" fill="var(--gold-400)" opacity="0.04" />
      {/* Video tiles */}
      <g>
        <rect x="70" y="78" width="98" height="74" rx="12" fill="var(--surface-1)" stroke="var(--line)" />
        <circle cx="119" cy="108" r="16" fill="var(--gold-400)" opacity="0.35" />
        <rect x="94" y="130" width="50" height="8" rx="4" fill="var(--line)" />
      </g>
      <g>
        <rect x="192" y="78" width="98" height="74" rx="12" fill="var(--surface-1)" stroke="var(--line)" />
        <circle cx="241" cy="108" r="16" fill="var(--gold-400)" opacity="0.55" />
        <rect x="216" y="130" width="50" height="8" rx="4" fill="var(--line)" />
      </g>
      <g>
        <rect x="70" y="164" width="98" height="74" rx="12" fill="var(--surface-1)" stroke="var(--line)" />
        <circle cx="119" cy="194" r="16" fill="var(--gold-400)" opacity="0.45" />
        <rect x="94" y="216" width="50" height="8" rx="4" fill="var(--line)" />
      </g>
      <g>
        <rect x="192" y="164" width="98" height="74" rx="12" fill="var(--surface-1)" stroke="var(--line)" />
        <circle cx="241" cy="194" r="16" fill="var(--gold-400)" opacity="0.3" />
        <rect x="216" y="216" width="50" height="8" rx="4" fill="var(--line)" />
      </g>
      {/* Connected link badge */}
      <circle cx="180" cy="158" r="26" fill="var(--gold-400)" />
      <g stroke="#000" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M175 158a6 6 0 0 1 6-6h4a6 6 0 0 1 0 12h-2" />
        <path d="M185 158a6 6 0 0 1-6 6h-4a6 6 0 0 1 0-12h2" />
      </g>
    </svg>
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

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gold-400)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
