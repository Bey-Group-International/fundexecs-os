"use client";

import { useMemo, useState } from "react";
import {
  parseTranscript,
  speakerInitials,
  transcriptSpeakers,
  transcriptWordCount,
} from "@/lib/meetings/transcript-view";
import { speakerColorIndex } from "@/lib/meetings/speaker-attribution";

// The transcript, typeset.
//
// It was a <pre> of monospace text: correct, and unreadable — an hour of two
// people talking as one undifferentiated block, where finding who said what
// meant reading every line.
//
// Now it reads as a record. Each turn carries the speaker in a fixed left
// column, so the eye can run down the names; the words are set in the body face
// rather than a terminal font; and where the room was not confident about
// attribution, that is a marker on the turn rather than an "(uncertain)" spliced
// into the middle of the sentence.

// The same palette the call assigns to tiles, so a person keeps their colour
// from the meeting into the record of it.
const SPEAKER_COLORS = [
  "var(--gold-400)",
  "#7dd3fc",
  "#c4b5fd",
  "#86efac",
  "#fda4af",
  "#fdba74",
];

export function TranscriptPanel({ transcript }: { transcript: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const turns = useMemo(() => parseTranscript(transcript), [transcript]);
  const speakers = useMemo(() => transcriptSpeakers(turns), [turns]);
  const words = useMemo(() => transcriptWordCount(turns), [turns]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return turns;
    return turns.filter(
      (t) =>
        t.speaker.toLowerCase().includes(q) ||
        t.paragraphs.some((p) => p.toLowerCase().includes(q)),
    );
  }, [turns, query]);

  const colorFor = (speaker: string) =>
    SPEAKER_COLORS[speakerColorIndex(speaker, SPEAKER_COLORS.length)];

  if (turns.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className={`shrink-0 text-[var(--fg-muted)] transition-transform ${open ? "rotate-90" : ""}`}>
          <ChevronIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
            Transcript
          </span>
          <span className="mt-0.5 block text-xs text-[var(--fg-muted)]">
            {turns.length} turn{turns.length === 1 ? "" : "s"}
            {speakers.length > 0 && ` · ${speakers.length} speaker${speakers.length === 1 ? "" : "s"}`}
            {` · ${words.toLocaleString()} words`}
          </span>
        </span>
        {speakers.length > 0 && (
          <span className="hidden shrink-0 items-center -space-x-1.5 sm:flex">
            {speakers.slice(0, 4).map((name) => (
              <span
                key={name}
                title={name}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--surface-1)] text-[10px] font-semibold text-[var(--surface-0)]"
                style={{ background: colorFor(name) }}
              >
                {speakerInitials(name)}
              </span>
            ))}
            {speakers.length > 4 && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--surface-1)] bg-[var(--surface-3)] text-[10px] font-medium text-[var(--fg-muted)]">
                +{speakers.length - 4}
              </span>
            )}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-[var(--line)]">
          <div className="border-b border-[var(--line)] px-4 py-2.5">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the transcript…"
              aria-label="Search the transcript"
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-1.5 text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--gold-400)] focus:outline-none"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-[var(--fg-muted)]">
              Nothing in the transcript matches “{query.trim()}”.
            </p>
          ) : (
            <ol className="max-h-[32rem] divide-y divide-[var(--line)] overflow-y-auto">
              {filtered.map((turn, i) => (
                <li key={i} className="flex gap-3 px-4 py-3 sm:gap-4">
                  {/* A fixed left column, so the eye can run down the names
                      rather than hunting for them inside the prose. */}
                  <div className="flex w-24 shrink-0 flex-col items-start gap-1 sm:w-32">
                    {turn.speaker ? (
                      <>
                        <span
                          className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-[var(--surface-0)]"
                          style={{ background: colorFor(turn.speaker) }}
                        >
                          {speakerInitials(turn.speaker)}
                        </span>
                        <span className="w-full truncate text-xs font-medium text-[var(--fg-secondary)]" title={turn.speaker}>
                          {turn.speaker}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs italic text-[var(--fg-muted)]">Unattributed</span>
                    )}
                    {turn.uncertain && (
                      <span
                        title={
                          turn.overlapped
                            ? "People were speaking over each other, so this attribution is uncertain."
                            : "The room was not confident who said this."
                        }
                        className="rounded px-1 py-0.5 text-[10px] font-medium text-[var(--status-warning)] ring-1 ring-[var(--status-warning)]/30"
                      >
                        {turn.overlapped ? "overlap" : "uncertain"}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    {turn.paragraphs.map((p, j) => (
                      <p key={j} className="text-sm leading-relaxed text-[var(--fg-primary)]">
                        {p}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
