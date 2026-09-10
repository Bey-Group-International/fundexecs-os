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
    <section className="fx-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="fx-focus flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-left transition-colors hover:bg-surface-2/70"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className={`shrink-0 text-fg-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          >
            <ChevronIcon />
          </span>
          <span className="truncate text-sm font-medium text-fg-primary">Analyze a transcript</span>
          <span className="hidden truncate text-xs text-fg-muted sm:inline">
            Sentiment, objections, commitment and a follow-up draft
          </span>
        </span>
      </button>

      {/* Hidden rather than unmounted: the console owns the pasted transcript,
          the analysis and any error, so collapsing the card would throw away
          work somebody waited on a model for. */}
      <div hidden={!open} className="border-t border-line/70 bg-surface-0/40 px-4 py-4">
        <MeetingCopilotConsole />
      </div>
    </section>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
