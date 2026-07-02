"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";

interface MeetingInfo {
  title: string;
  status: "waiting" | "active" | "ended";
  host_id: string | null;
}

export default function MeetingInvitePage() {
  const params = useParams();
  const router = useRouter();
  const roomCode = typeof params.roomCode === "string" ? params.roomCode : "";

  const [meeting, setMeeting] = useState<MeetingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [mode, setMode] = useState<"choose" | "guest">("choose");
  const [guestName, setGuestName] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    async function fetchMeeting() {
      const supabase = createClient();
      const { data } = await supabase
        .from("live_meetings")
        .select("title, status, host_id")
        .eq("room_code", roomCode)
        .maybeSingle();
      if (!data) { setNotFound(true); }
      else { setMeeting(data as MeetingInfo); }
      setLoading(false);
    }
    if (roomCode) void fetchMeeting();
  }, [roomCode]);

  function handleSignUp() {
    router.push(`/login?mode=signup&redirect=/meetings/${roomCode}`);
  }

  function handleSignIn() {
    router.push(`/login?redirect=/meetings/${roomCode}`);
  }

  async function handleGuestJoin(e: React.FormEvent) {
    e.preventDefault();
    const name = guestName.trim();
    if (!name) return;
    setJoining(true);
    // Store guest name in sessionStorage so MeetingRoom can pick it up
    sessionStorage.setItem(`guest_name_${roomCode}`, name);
    router.push(`/meeting-room/${roomCode}?guest=1&name=${encodeURIComponent(name)}`);
  }

  if (loading) {
    return (
      <div className="fx-blueprint flex min-h-screen items-center justify-center bg-surface-0">
        <div className="w-5 h-5 border-2 border-[var(--gold-400)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="fx-blueprint flex min-h-screen flex-col items-center justify-center bg-surface-0 gap-4 px-4">
        <Logo />
        <p className="text-[var(--fg-secondary)] text-sm">This meeting link is invalid or has expired.</p>
        <a href="/login" className="text-[var(--gold-400)] text-sm hover:underline">Sign in to FundExecs OS →</a>
      </div>
    );
  }

  return (
    <div className="fx-blueprint flex min-h-screen flex-col items-center justify-center bg-surface-0 px-4 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3">
          <Logo />
          <div className="text-center">
            <p className="text-xs font-mono uppercase tracking-widest text-[var(--fg-muted)] mb-1">You&apos;re invited to</p>
            <h1 className="text-xl font-semibold text-[var(--fg-primary)]">{meeting?.title ?? "Meeting"}</h1>
            {meeting?.status === "active" && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-xs text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Live now
              </span>
            )}
            {meeting?.status === "waiting" && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-xs text-yellow-400">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" /> Starting soon
              </span>
            )}
            {meeting?.status === "ended" && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-xs text-[var(--fg-muted)]">Meeting has ended</span>
            )}
          </div>
        </div>

        {meeting?.status !== "ended" && mode === "choose" && (
          <div className="fx-glass rounded-xl p-5 flex flex-col gap-3">
            <p className="text-sm text-[var(--fg-secondary)] text-center">How would you like to join?</p>

            <button
              onClick={handleSignUp}
              className="w-full rounded-lg bg-[var(--gold-400)] text-black text-sm font-semibold py-2.5 hover:opacity-90 transition-opacity"
            >
              Sign up for full access
            </button>

            <button
              onClick={handleSignIn}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-primary)] text-sm font-medium py-2.5 hover:bg-[var(--surface-3)] transition-colors"
            >
              Already have an account? Sign in
            </button>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-[var(--line)]" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--fg-muted)]">or</span>
              <span className="h-px flex-1 bg-[var(--line)]" />
            </div>

            <button
              onClick={() => setMode("guest")}
              className="w-full rounded-lg border border-[var(--line)] text-[var(--fg-secondary)] text-sm py-2.5 hover:text-[var(--fg-primary)] hover:bg-[var(--surface-2)] transition-colors"
            >
              Continue as guest
            </button>

            <p className="text-[10px] text-[var(--fg-muted)] text-center leading-relaxed">
              Guests can join this meeting without an account. Sign up for AI transcription, notes, and action items.
            </p>
          </div>
        )}

        {meeting?.status !== "ended" && mode === "guest" && (
          <form onSubmit={handleGuestJoin} className="fx-glass rounded-xl p-5 flex flex-col gap-3">
            <p className="text-sm text-[var(--fg-secondary)] text-center">Enter your name to join</p>
            <input
              autoFocus
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Your name"
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
            />
            <button
              type="submit"
              disabled={!guestName.trim() || joining}
              className="w-full rounded-lg bg-[var(--gold-400)] text-black text-sm font-semibold py-2.5 hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {joining ? "Joining…" : "Join as guest"}
            </button>
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] transition-colors"
            >
              Back
            </button>
          </form>
        )}

        {meeting?.status === "ended" && (
          <div className="fx-glass rounded-xl p-5 flex flex-col gap-3 items-center text-center">
            <p className="text-sm text-[var(--fg-muted)]">This meeting has already ended.</p>
            <button onClick={handleSignUp} className="text-[var(--gold-400)] text-sm hover:underline">
              Create a FundExecs OS account →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
