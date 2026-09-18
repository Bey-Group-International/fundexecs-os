"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseTranscript,
  speakerInitials,
  transcriptSpeakers,
  transcriptWordCount,
} from "@/lib/meetings/transcript-view";
import { speakerColorIndex } from "@/lib/meetings/speaker-attribution";
import { cueAt, cuesAreTimed, cuesCanFollow, type TranscriptCue } from "@/lib/meetings/transcript-cues";
import {
  findMatches,
  matchSummary,
  splitParagraph,
  stepMatch,
} from "@/lib/meetings/transcript-search";
import { formatClock } from "@/lib/meetings/recording-timeline";

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

export function TranscriptPanel({
  transcript,
  cues,
  onSeek,
  currentMs,
}: {
  transcript: string;
  /**
   * The same transcript, from the rows the room wrote while people spoke.
   *
   * Preferred when present, because only the rows carry a time — and a time is
   * the difference between a transcript you read and one you can use. The
   * rendered text stays the fallback, for meetings whose rows predate this and
   * for anyone whose access reaches the report but not the rows.
   */
  cues?: TranscriptCue[];
  /** Jump the recording to a moment. Absent, timestamps are not offered. */
  onSeek?: (ms: number) => void;
  /**
   * Where the recording has got to, so the transcript can follow it.
   *
   * The other half of a link that only ever ran one way: a line could drive
   * the player, and the player reported to nobody — so watching a meeting back
   * meant scrolling this by hand to keep up.
   */
  currentMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** Which hit the reader is on. -1 is "typed, but stepped to nothing yet". */
  const [at, setAt] = useState(-1);
  /** Following is on by default and off the moment somebody scrolls away. */
  const [follow, setFollow] = useState(true);

  const timed = Boolean(onSeek && cues && cuesAreTimed(cues));
  const turns = useMemo(
    () => (cues && cues.length > 0 ? cues : parseTranscript(transcript)),
    [cues, transcript],
  );
  const speakers = useMemo(() => transcriptSpeakers(turns), [turns]);
  const words = useMemo(() => transcriptWordCount(turns), [turns]);

  // Located rather than filtered. Filtering removed the conversation around a
  // hit, which is the part that makes a hit mean anything — "Yes, about forty"
  // is not an answer until the question above it is visible.
  const matches = useMemo(() => findMatches(turns, query), [turns, query]);
  useEffect(() => { setAt(matches.length ? 0 : -1); }, [matches]);

  // The line being spoken, when there is a clock worth trusting. See
  // cuesCanFollow: a meeting recorded from halfway has every earlier turn
  // clamped to zero, and marking one of those as "now" would invent a fact.
  const canFollow = Boolean(cues && cuesCanFollow(cues));
  const playing = canFollow && typeof currentMs === "number" ? cueAt(cues!, currentMs) : -1;

  const listRef = useRef<HTMLOListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const markRef = useRef<HTMLElement>(null);

  // Stepping to a hit takes priority over following: somebody who searched is
  // reading, not watching, and having the playhead drag them away mid-sentence
  // is the behaviour that makes people turn sync off.
  useEffect(() => {
    if (!open) return;
    const target = markRef.current ?? (matches.length === 0 && follow ? activeRef.current : null);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [open, at, playing, matches.length, follow]);

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
          <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Enter for the next hit, Shift+Enter for the previous one —
              // the shape every find box has, so nobody has to be told.
              onKeyDown={(e) => {
                if (e.key !== "Enter" || matches.length === 0) return;
                e.preventDefault();
                setAt((n) => stepMatch(n, matches.length, e.shiftKey ? -1 : 1));
              }}
              placeholder="Search the transcript…"
              aria-label="Search the transcript"
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-1.5 text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--gold-400)] focus:outline-none"
            />
            {query.trim() && (
              <>
                {/* Announced, because a count that only exists visually is a
                    count a screen reader user has to infer from the noise of
                    a list scrolling. */}
                <span role="status" aria-live="polite" className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-[var(--fg-muted)]">
                  {matchSummary(at, matches.length, query)}
                </span>
                <button
                  type="button"
                  onClick={() => setAt((n) => stepMatch(n, matches.length, -1))}
                  disabled={matches.length === 0}
                  aria-label="Previous match"
                  className="shrink-0 rounded-lg border border-[var(--line)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:border-gold-400/40 disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => setAt((n) => stepMatch(n, matches.length, 1))}
                  disabled={matches.length === 0}
                  aria-label="Next match"
                  className="shrink-0 rounded-lg border border-[var(--line)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:border-gold-400/40 disabled:opacity-40"
                >
                  ↓
                </button>
              </>
            )}
          </div>

          {/* The transcript stays whole. It used to be filtered down to the
              turns containing the query, which threw away the conversation
              around every hit — and the line before a hit is usually the
              question the hit is answering. */}
          <ol
            ref={listRef}
            // Following is a convenience, not a leash: the first scroll turns
            // it off, and it comes back when the reader asks for it.
            onWheel={() => setFollow(false)}
            onTouchMove={() => setFollow(false)}
            className="max-h-[32rem] divide-y divide-[var(--line)] overflow-y-auto"
          >
              {turns.map((turn, i) => (
                <li
                  key={i}
                  ref={i === playing ? activeRef : undefined}
                  aria-current={i === playing ? "true" : undefined}
                  className={`flex gap-3 px-4 py-3 sm:gap-4 transition-colors ${
                    i === playing ? "bg-gold-400/10" : ""
                  }`}
                >
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
                    {/* Offered only when it would do something: there is a
                        player to drive, and the cues carry a real clock. */}
                    {timed && (
                      <button
                        type="button"
                        onClick={() => onSeek?.((turn as TranscriptCue).atMs)}
                        className="font-mono text-[11px] tabular-nums text-[var(--gold-400)] hover:underline"
                        title="Play the recording from here"
                      >
                        {formatClock((turn as TranscriptCue).atMs)}
                      </button>
                    )}
                    {turn.uncertain && (
                      <span
                        title={
                          turn.overlapped
                            ? "People were speaking over each other, so this attribution is uncertain."
                            : "The room was not confident who said this."
                        }
                        className="rounded px-1 py-0.5 text-[10px] font-medium text-[var(--status-warning)] ring-1 ring-status-warning/30"
                      >
                        {turn.overlapped ? "overlap" : "uncertain"}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    {turn.paragraphs.map((paragraph, j) => (
                      <p key={j} className="text-sm leading-relaxed text-[var(--fg-primary)]">
                        {/* Painted in place rather than the turn being pulled
                            out of the transcript. Parts, never markup: these
                            are other people's words. */}
                        {splitParagraph(paragraph, matches, i, j).map((part, k) =>
                          part.match ? (
                            <mark
                              key={k}
                              ref={part.index === at ? markRef : undefined}
                              className={
                                part.index === at
                                  ? "rounded bg-[var(--gold-400)] px-0.5 text-[var(--surface-0)]"
                                  : "rounded bg-gold-400/25 px-0.5 text-[var(--fg-primary)]"
                              }
                            >
                              {part.value}
                            </mark>
                          ) : (
                            <span key={k}>{part.value}</span>
                          ),
                        )}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
          </ol>

          {query.trim() && matches.length === 0 && (
            <p className="border-t border-[var(--line)] px-4 py-3 text-center text-xs text-[var(--fg-muted)]">
              Nothing in the transcript matches “{query.trim()}”.
            </p>
          )}

          {/* Offered only once it has been turned off, and only when there is
              something to follow. */}
          {canFollow && !follow && (
            <button
              type="button"
              onClick={() => setFollow(true)}
              className="w-full border-t border-[var(--line)] px-4 py-2 text-center text-[11px] text-[var(--gold-400)] hover:underline"
            >
              Follow the recording
            </button>
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
