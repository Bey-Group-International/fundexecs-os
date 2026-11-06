"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LineActions, TranscriptToolbar } from "./TranscriptTools";
import type { OverlayRow } from "@/lib/meetings/transcript-tools";
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
  groupMatchesByTurn,
  matchSummary,
  MIN_QUERY,
  partsFor,
  SPEAKER,
  stepMatch,
  type TurnMatches,
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

/**
 * A speaker's colour. Module scope rather than a closure in the component,
 * because the memoised turn below takes it — and a function recreated on every
 * render is a prop that changes on every render, which would defeat that memo
 * silently.
 */
function colorFor(speaker: string): string {
  return SPEAKER_COLORS[speakerColorIndex(speaker, SPEAKER_COLORS.length)];
}

/**
 * One turn of the transcript.
 *
 * Memoised, and the reason is the playhead. `playing` is a single index, so the
 * list re-rendered EVERY turn once a second to move one row's background — and a
 * turn is not a cheap row: a speaker chip, a clock button, and a nested map over
 * paragraphs and search-match parts. An hour of two people talking is hundreds of
 * them, rebuilt every second for as long as the recording plays, on the same
 * thread decoding it.
 *
 * Every prop is a primitive, a stable ref, or a value the panel memoises
 * (`hits` on the query; `onSeek` by the page). `active` is the only one that
 * moves as the recording plays, and it moves for exactly two turns: the one being
 * left and the one being reached. `at` changes when somebody steps through search
 * hits, which does re-render the list — a keypress, not a clock.
 *
 * `hits` is this turn's own matches rather than the whole match table, and that
 * is the difference between the memo working and not. The table is a new object
 * on every keystroke, so a row handed the table re-rendered on every keystroke
 * even though a transcript is hundreds of rows of which a handful match.
 * `undefined` for a row with no matches compares equal to last keystroke's
 * `undefined`, so those rows hold still. The per-text lookup stays INSIDE, where
 * it allocates nothing the parent would have to keep stable.
 */
const TranscriptTurn = memo(function TranscriptTurn({
  turn,
  index,
  active,
  activeRef,
  markRef,
  at,
  hits,
  timed,
  onSeek,
  lineTools,
}: {
  turn: ReturnType<typeof parseTranscript>[number] | TranscriptCue;
  index: number;
  /** This turn is the one being spoken. Moves for two rows per second, not all. */
  active: boolean;
  /** Attached only while active, so the follow-the-recording scroll finds it. */
  activeRef: React.RefObject<HTMLLIElement | null>;
  markRef: React.RefObject<HTMLElement | null>;
  at: number;
  /**
   * This turn's matches only — `undefined` when it has none, which is most of
   * them. Handing every row the whole table meant a new object per keystroke and
   * so a re-render of every row; `undefined` is the same `undefined` as last
   * time, so a row with nothing to highlight holds still. See
   * groupMatchesByTurn.
   */
  hits: TurnMatches | undefined;
  timed: boolean;
  onSeek?: (ms: number) => void;
  /** Quote and correct actions on each line; null to show the transcript bare. */
  lineTools: LineTools | null;
}) {
  const cue = turn as Partial<TranscriptCue>;
  return (
    <li
      ref={active ? activeRef : undefined}
      aria-current={active ? "true" : undefined}
      className={`flex gap-3 px-4 py-3 sm:gap-4 transition-colors ${
        active ? "bg-gold-400/10" : ""
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
            {/* The name is searchable too — the filter this
                replaced matched on it, and "what did Priya say" is
                half of what anyone asks a transcript. */}
            <span className="w-full truncate text-xs font-medium text-[var(--fg-secondary)]" title={turn.speaker}>
              {partsFor(turn.speaker, hits?.get(SPEAKER)).map((part, k) =>
                part.match ? (
                  <mark
                    key={k}
                    ref={part.index === at ? markRef : undefined}
                    className={
                      part.index === at
                        ? "rounded bg-[var(--gold-400)] px-0.5 text-[var(--surface-0)]"
                        : "rounded bg-gold-400/25 px-0.5 text-[var(--fg-secondary)]"
                    }
                  >
                    {part.value}
                  </mark>
                ) : (
                  <span key={k}>{part.value}</span>
                ),
              )}
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
          <p key={j} className="group text-sm leading-relaxed text-[var(--fg-primary)]">
            {/* Painted in place rather than the turn being pulled
                out of the transcript. Parts, never markup: these
                are other people's words. */}
            {partsFor(paragraph, hits?.get(j)).map((part, k) =>
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
            {lineTools && (
              <LineActions
                text={paragraph}
                speaker={turn.speaker}
                atMs={timed && typeof cue.atMs === "number" ? cue.atMs : null}
                lineId={cue.lineIds?.[j] ?? null}
                original={cue.originals?.[j] ?? null}
                canEdit={lineTools.canEdit}
                onEdit={lineTools.onEdit}
              />
            )}
          </p>
        ))}
      </div>
    </li>
  );
});

interface LineTools {
  canEdit: boolean;
  onEdit: (lineId: string, text: string | null) => Promise<string | null>;
}

export interface TranscriptToolsProps {
  meetingId: string;
  isHost: boolean;
  /** The timed rows, as shown, for talk time. */
  rows: readonly OverlayRow[];
  /** Speaker label as heard → name shown, as loaded. */
  speakerNames: Readonly<Record<string, string>>;
}

export function TranscriptPanel({
  transcript,
  cues,
  onSeek,
  currentMs,
  tools,
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
  /** Download, talk time, speaker names, quotes and corrections. Absent, the transcript is read-only. */
  tools?: TranscriptToolsProps;
}) {
  const [open, setOpen] = useState(false);
  // Names and corrections made on this page since it loaded, laid over what
  // the server already applied.
  const loadedNames = tools?.speakerNames;
  const heardOf = useMemo(() => {
    const inverse = new Map<string, string>();
    for (const [heard, shown] of Object.entries(loadedNames ?? {})) inverse.set(shown, heard);
    return (shown: string) => inverse.get(shown) ?? shown;
  }, [loadedNames]);
  const [names, setNames] = useState<Map<string, string>>(() => new Map(Object.entries(loadedNames ?? {})));
  const [edits, setEdits] = useState<Map<string, { text: string; original: string | null }>>(() => new Map());
  const shownName = useCallback((speaker: string) => {
    const heard = heardOf(speaker);
    return names.get(heard) ?? heard;
  }, [heardOf, names]);
  const [query, setQuery] = useState("");
  /** Which hit the reader is on. -1 is "typed, but stepped to nothing yet". */
  const [at, setAt] = useState(-1);
  /** Following is on by default and off the moment somebody scrolls away. */
  const [follow, setFollow] = useState(true);

  const timed = Boolean(onSeek && cues && cuesAreTimed(cues));
  const baseTurns = useMemo(
    () => (cues && cues.length > 0 ? cues : parseTranscript(transcript)),
    [cues, transcript],
  );
  const turns = useMemo(() => {
    if (!tools) return baseTurns;
    return baseTurns.map((t) => {
      const cue = t as Partial<TranscriptCue>;
      const speaker = t.speaker ? shownName(t.speaker) : t.speaker;
      if (!cue.lineIds || !edits.size) return speaker === t.speaker ? t : { ...t, speaker };
      const paragraphs = t.paragraphs.slice();
      const originals = (cue.originals ?? []).slice();
      cue.lineIds.forEach((id, j) => {
        const e = id ? edits.get(id) : undefined;
        if (!e) return;
        paragraphs[j] = e.text;
        originals[j] = e.original;
      });
      return { ...t, speaker, paragraphs, originals };
    });
  }, [baseTurns, tools, shownName, edits]);
  const heardSpeakers = useMemo(() => {
    const out: string[] = [];
    for (const t of baseTurns) {
      const h = t.speaker ? heardOf(t.speaker) : "";
      if (h && !out.includes(h)) out.push(h);
    }
    return out;
  }, [baseTurns, heardOf]);
  const talkRows = useMemo(
    () => (tools ? tools.rows.map((r) => ({ ...r, speaker: r.speaker ? shownName(r.speaker) : r.speaker })) : []),
    [tools, shownName],
  );

  const rename = useCallback(
    async (heard: string, display: string | null): Promise<string | null> => {
      if (!tools) return null;
      try {
        const res = await fetch(`/api/meetings/${tools.meetingId}/transcript/speakers`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ original: heard, display }),
        });
        const body = (await res.json().catch(() => ({}))) as { display?: string | null; error?: string };
        if (!res.ok) return body.error ?? "Couldn't save the name.";
        setNames((prev) => {
          const next = new Map(prev);
          if (body.display) next.set(heard, body.display);
          else next.delete(heard);
          return next;
        });
        return null;
      } catch {
        return "Couldn't save the name. Check your connection.";
      }
    },
    [tools],
  );

  const editLine = useCallback(
    async (lineId: string, text: string | null): Promise<string | null> => {
      if (!tools) return null;
      try {
        const res = await fetch(`/api/meetings/${tools.meetingId}/transcript/lines/${lineId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const body = (await res.json().catch(() => ({}))) as { text?: string; original?: string | null; error?: string };
        if (!res.ok || typeof body.text !== "string") return body.error ?? "Couldn't save the correction.";
        setEdits((prev) => new Map(prev).set(lineId, { text: body.text!, original: body.original ?? null }));
        return null;
      } catch {
        return "Couldn't save the correction. Check your connection.";
      }
    },
    [tools],
  );

  const lineTools = useMemo<LineTools | null>(
    () => (tools ? { canEdit: tools.isHost, onEdit: editLine } : null),
    [tools, editLine],
  );
  const speakers = useMemo(() => transcriptSpeakers(turns), [turns]);
  const words = useMemo(() => transcriptWordCount(turns), [turns]);

  // Located rather than filtered. Filtering removed the conversation around a
  // hit, which is the part that makes a hit mean anything — "Yes, about forty"
  // is not an answer until the question above it is visible.
  const matches = useMemo(() => findMatches(turns, query), [turns, query]);
  const byTurn = useMemo(() => groupMatchesByTurn(matches), [matches]);
  useEffect(() => { setAt(matches.length ? 0 : -1); }, [matches]);

  // The line being spoken, when there is a clock worth trusting. See
  // cuesCanFollow: a meeting recorded from halfway has every earlier turn
  // clamped to zero, and marking one of those as "now" would invent a fact.
  const canFollow = Boolean(cues && cuesCanFollow(cues));
  const playing = canFollow && typeof currentMs === "number" ? cueAt(cues!, currentMs) : -1;

  const listRef = useRef<HTMLOListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const markRef = useRef<HTMLElement>(null);

  // Stepping to a hit. Deliberately NOT keyed on the playhead: an effect that
  // re-runs every second and re-centres the current hit drags a reader who has
  // scrolled away back to it, which is the behaviour this is supposed to
  // prevent. Searching moves the transcript only when the reader steps.
  useEffect(() => {
    if (!open || at < 0) return;
    scrollWithin(listRef.current, markRef.current);
  }, [open, at]);

  // Following the recording. Yields to a search — somebody who searched is
  // reading, not watching — and to the first scroll.
  useEffect(() => {
    if (!open || !follow || matches.length > 0) return;
    scrollWithin(listRef.current, activeRef.current);
  }, [open, playing, follow, matches.length]);

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

          {tools && (
            <TranscriptToolbar
              meetingId={tools.meetingId}
              isHost={tools.isHost}
              rows={talkRows}
              speakers={heardSpeakers}
              names={names}
              onRename={rename}
            />
          )}

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
                <TranscriptTurn
                  key={i}
                  turn={turn}
                  index={i}
                  active={i === playing}
                  activeRef={activeRef}
                  markRef={markRef}
                  at={at}
                  hits={byTurn.get(i)}
                  timed={timed}
                  onSeek={onSeek}
                  lineTools={lineTools}
                />
              ))}
          </ol>

          {query.trim().length >= MIN_QUERY && matches.length === 0 && (
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

/**
 * Centre an element inside the transcript's own scroller.
 *
 * NOT scrollIntoView: that scrolls every scrollable ancestor, and the report
 * page's <main> is one — so following the playhead yanked the whole page back
 * to the transcript at every turn boundary. This moves one box.
 */
function scrollWithin(list: HTMLElement | null, target: HTMLElement | null) {
  if (!list || !target) return;
  const listBox = list.getBoundingClientRect();
  const targetBox = target.getBoundingClientRect();
  const delta = targetBox.top - listBox.top - (list.clientHeight - targetBox.height) / 2;
  const top = Math.max(0, list.scrollTop + delta);
  // jsdom has no scrollTo, and neither do some older engines; the property
  // assignment is the behaviour that matters, the smoothness is not.
  if (typeof list.scrollTo === "function") list.scrollTo({ top, behavior: "smooth" });
  else list.scrollTop = top;
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
