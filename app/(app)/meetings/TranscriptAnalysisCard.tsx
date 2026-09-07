"use client";

import { useState } from "react";
import { MeetingCopilotConsole } from "@/app/(app)/meetings/MeetingCopilotConsole";

/**
 * Transcript analysis, on the meetings page rather than inside a call.
 *
 * This used to be a tab in the in-call copilot, which was the wrong room for
 * it: it takes a transcript pasted in by hand and has no connection to the
 * meeting happening around it. Nobody pastes a transcript while someone is
 * talking to them. It belongs here, between meetings, next to the ones it would
 * be about.
 *
 * Collapsed by default. It is a form with a large textarea, and this page is
 * for seeing what is coming up — an occasional tool should not outweigh that.
 */
export function TranscriptAnalysisCard() {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-[var(--gold-400)]">✦</span>
          <span className="truncate text-sm font-medium text-[var(--fg-primary)]">
            Analyze a transcript
          </span>
          <span className="hidden truncate text-xs text-[var(--fg-muted)] sm:inline">
            Sentiment, objections, commitment and a follow-up draft
          </span>
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-[var(--fg-muted)] transition-transform ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--line)] px-4 py-4">
          <MeetingCopilotConsole />
        </div>
      )}
    </section>
  );
}
