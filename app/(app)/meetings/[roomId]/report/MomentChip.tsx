"use client";

// "▶ 12:34" beside a line of the report: play the recording from where it was
// said.
//
// The chip lives on the overview and the player on the recording tab, which
// are siblings with no parent in the client to share state through — the page
// is server-rendered. So the chip opens the tab through its hash, which the
// tab bar already follows, and asks for the moment with a window event, which
// the media panel listens for. Both are mounted all along (inactive tabs are
// hidden, not unmounted), so the request lands on a player that exists.
import { momentClock, SEEK_EVENT, type SeekDetail } from "@/lib/meetings/report-moments";

export function requestMoment(ms: number) {
  if (typeof window === "undefined") return;
  // The tab first, so the player is on screen by the time it starts.
  if (window.location.hash !== "#recording") window.location.hash = "recording";
  window.dispatchEvent(new CustomEvent<SeekDetail>(SEEK_EVENT, { detail: { ms, play: true } }));
}

export function MomentChip({ ms, what }: { ms: number; what: string }) {
  const clock = momentClock(ms);
  return (
    <button
      type="button"
      onClick={() => requestMoment(ms)}
      aria-label={`Play from ${clock}, where ${what} was discussed`}
      title="Play the recording from here"
      className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface-0)] px-2 font-mono text-[11px] tabular-nums text-[var(--fg-secondary)] transition-colors hover:border-gold-400/50 hover:text-[var(--fg-primary)] sm:min-h-6"
    >
      <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 4v16l14-8z" />
      </svg>
      {clock}
    </button>
  );
}
