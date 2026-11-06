"use client";

// The live transcript, as the call's Transcript tab shows it: one speaker's
// fragments read as one turn, searchable with the matches marked in place,
// and copyable or downloadable at any point in the call. A moment can be
// bookmarked from here without leaving the tab.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { chatClock } from "@/lib/meetings/chat";
import { mergeFragments, transcriptAsText, transcriptFileName } from "@/lib/meetings/notetaker";
import type { LiveTranscriptLine } from "./CallParts";

type SrStatus = "idle" | "active" | "failing" | "error" | "unsupported";

/** Where each match sits: which turn, and the span inside its text. */
function findMatches(turns: ReadonlyArray<{ id: string; text: string }>, query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: Array<{ turnId: string; start: number; end: number }> = [];
  for (const t of turns) {
    const hay = t.text.toLowerCase();
    let at = hay.indexOf(q);
    while (at !== -1) {
      out.push({ turnId: t.id, start: at, end: at + q.length });
      at = hay.indexOf(q, at + q.length);
    }
  }
  return out;
}

export function LiveTranscriptPanel({
  lines,
  srStatus,
  paused = false,
  meetingTitle,
  colorFor,
  onBookmark,
}: {
  lines: readonly LiveTranscriptLine[];
  srStatus: SrStatus;
  /** The host has paused the notetaker. */
  paused?: boolean;
  meetingTitle: string;
  colorFor: (speakerId: string) => string;
  /** Flag the current moment. Absent for a guest, who has nowhere to keep it. */
  onBookmark?: (label?: string) => Promise<boolean>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  const turns = useMemo(() => mergeFragments(lines), [lines]);
  const matches = useMemo(() => findMatches(turns, query), [turns, query]);
  const current = matches.length ? matches[Math.min(active, matches.length - 1)] : null;

  useEffect(() => setActive(0), [query]);

  // Newest line in view as it arrives, unless the reader scrolled up or is searching.
  useEffect(() => {
    if (!follow.current || query.trim()) return;
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [turns, query]);

  // The active match, brought into view.
  useEffect(() => {
    if (!current) return;
    const el = boxRef.current?.querySelector(`[data-turn="${CSS.escape(current.turnId)}"]`);
    if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ block: "center" });
  }, [current]);

  function flash(text: string) {
    setNote(text);
    setTimeout(() => setNote(null), 2500);
  }

  function asText(): string {
    return transcriptAsText(
      turns.map((t) => ({ speaker: t.isLocal ? t.speaker || "You" : t.speaker, text: t.text, ts: t.ts, final: t.final })),
      (ts) => chatClock(ts),
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText());
      flash("Copied");
    } catch {
      flash("Couldn't copy");
    }
  }

  function download() {
    const blob = new Blob([asText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = transcriptFileName(meetingTitle, new Date());
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function bookmark() {
    if (!onBookmark) return;
    flash((await onBookmark()) ? "Bookmarked" : "Couldn't bookmark");
  }

  function step(by: number) {
    if (!matches.length) return;
    setActive((i) => (i + by + matches.length) % matches.length);
  }

  function jumpToLatest() {
    follow.current = true;
    setFollowing(true);
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }

  const btn =
    "shrink-0 min-h-8 rounded-md border border-[var(--line)] px-2 text-[11px] text-[var(--fg-secondary,var(--fg-primary))] hover:bg-[var(--surface-2)] disabled:opacity-40";

  return (
    <div className="-m-3 flex flex-1 min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-[var(--line)] p-3 pb-2">
        <div className="flex items-center gap-1.5">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Search the transcript"
            aria-label="Search transcript"
            className="min-w-0 flex-1 min-h-8 rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 text-xs text-[var(--fg-primary)]"
          />
          {query.trim().length >= 2 && (
            <>
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--fg-muted)]" aria-live="polite">
                {matches.length ? `${Math.min(active, matches.length - 1) + 1} of ${matches.length}` : "No matches"}
              </span>
              <button type="button" className={btn} onClick={() => step(-1)} disabled={!matches.length} aria-label="Previous match">
                ↑
              </button>
              <button type="button" className={btn} onClick={() => step(1)} disabled={!matches.length} aria-label="Next match">
                ↓
              </button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {onBookmark && (
            <button type="button" className={btn} onClick={bookmark} disabled={paused}>
              🔖 Bookmark now
            </button>
          )}
          <button type="button" className={btn} onClick={copy} disabled={!turns.length}>
            Copy
          </button>
          <button type="button" className={btn} onClick={download} disabled={!turns.length}>
            Download
          </button>
          {note && (
            <span className="text-[11px] text-[var(--fg-muted)]" aria-live="polite">
              {note}
            </span>
          )}
        </div>
      </div>

      <div
        ref={boxRef}
        onScroll={(e) => {
          const box = e.currentTarget;
          const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
          follow.current = atEnd;
          if (atEnd !== following) setFollowing(atEnd);
        }}
        className="relative flex flex-1 flex-col gap-2.5 overflow-y-auto p-3"
      >
        <p className="text-[11px] text-[var(--fg-muted)]">
          {paused
            ? "The notetaker is paused. Nothing said now is transcribed."
            : srStatus === "active"
              ? "Live — what's said with mics on. The meeting report is written from this."
              : srStatus === "unsupported"
                ? "This browser can't transcribe. Lines from others still appear here."
                : "Not transcribing your mic right now. Lines from others still appear here."}
        </p>
        {turns.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--fg-muted)]">Nothing transcribed yet. Lines appear here as people speak.</p>
        ) : (
          turns.map((turn) => {
            const own = matches.filter((m) => m.turnId === turn.id);
            return (
              <div key={turn.id} data-turn={turn.id} className={`flex min-w-0 flex-col gap-0.5 ${turn.final ? "" : "opacity-60"}`}>
                <span className="flex items-baseline gap-2">
                  <span className="break-words text-xs font-medium" style={{ color: colorFor(turn.speakerId) }}>
                    {turn.isLocal ? "You" : turn.speaker}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-[var(--fg-muted)]">{chatClock(turn.ts)}</span>
                </span>
                <p className={`break-words text-sm text-[var(--fg-primary)] ${turn.final ? "" : "italic"}`}>
                  {own.length ? <Highlighted text={turn.text} spans={own} current={current} /> : turn.text}
                </p>
              </div>
            );
          })
        )}
      </div>
      {!following && !query.trim() && turns.length > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="mx-auto -mt-10 mb-2 rounded-full border border-[var(--line)] bg-[var(--surface-1)] px-3 py-1 text-[11px] text-[var(--fg-primary)] shadow"
        >
          ↓ Latest
        </button>
      )}
    </div>
  );
}

function Highlighted({
  text,
  spans,
  current,
}: {
  text: string;
  spans: ReadonlyArray<{ turnId: string; start: number; end: number }>;
  current: { turnId: string; start: number } | null;
}) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  spans.forEach((s, i) => {
    if (s.start > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, s.start)}</Fragment>);
    const isCurrent = current?.turnId === s.turnId && current.start === s.start;
    parts.push(
      <mark key={`m${i}`} data-current={isCurrent || undefined} className={`rounded-sm px-0.5 ${isCurrent ? "bg-[var(--gold-400)] text-black" : "bg-[var(--gold-400)]/30 text-inherit"}`}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    at = s.end;
  });
  if (at < text.length) parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}
