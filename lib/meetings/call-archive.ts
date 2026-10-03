// lib/meetings/call-archive.ts
// Finding a recorded call months after it happened.
//
// The point of recording a phone call is almost never the recording. It is
// being able to answer "what did we actually agree with Dunbar in March" — and
// a list of forty rows called "Call · Mar 4, 2:15 PM" answers that only if you
// can search what was SAID, not what the call was called.
//
// So the archive searches transcripts, and a hit has to arrive with enough of
// the sentence around it to be recognised without opening the call. That is
// what this file is: where to cut, and how to show it.
//
// The match-finding itself is transcript-search.ts, unchanged — the same
// function the report page highlights with. Two search implementations over
// the same transcripts would eventually disagree about what matches, and the
// one nobody was looking at would be the wrong one.
//
// Pure: no React, no DOM, no Supabase.

import { findMatches, MIN_QUERY, type TranscriptMatch } from "@/lib/meetings/transcript-search";
import { parseTranscript } from "@/lib/meetings/transcript-view";

/** One call, as the archive lists it. */
export interface ArchivedCall {
  id: string;
  roomCode: string;
  title: string;
  /** When the call happened. */
  at: string;
  /** Seconds, from the recording's own parts. Null when nothing was recorded. */
  durationSeconds: number | null;
  /** The report's summary, when one was written. */
  summary: string;
  /** Whether consent was acknowledged and stored. */
  consented: boolean;
  /**
   * The recording the row plays and downloads: the longest surviving one, the
   * same one `durationSeconds` describes. Null (or absent, in older payloads)
   * when nothing playable was kept.
   */
  recordingId?: string | null;
}

/** A call that matched a search, with the words around the hit. */
export interface CallHit extends ArchivedCall {
  /** How many times the query appears in this call. */
  matches: number;
  /** The sentence around the first hit, cut to fit a row. */
  snippet: Snippet | null;
}

/**
 * A snippet, as parts rather than markup.
 *
 * The same rule the transcript panel follows, for the same reason: these are
 * other people's words, and a renderer that builds HTML out of them is a
 * renderer that can be made to build something else.
 */
export interface Snippet {
  /** Who was speaking, when the transcript records it. */
  speaker: string;
  parts: Array<{ value: string; match: boolean }>;
}

/**
 * How much of the sentence to keep on either side of a hit.
 *
 * Wide enough that the hit is recognisable — "Yes, about forty" means nothing
 * without the question above it — and narrow enough that a row stays a row.
 */
export const SNIPPET_BEFORE = 60;
export const SNIPPET_AFTER = 90;

/** An ellipsis that is one character, so the cut does not look like a typo. */
const ELLIPSIS = "…";

/**
 * Search one call's stored transcript.
 *
 * Returns null when the call does not match at all, so a caller can filter on
 * it — rather than a zero-match hit that has to be checked for separately and
 * eventually will not be.
 */
export function searchCall(call: ArchivedCall, transcript: string, query: string): CallHit | null {
  if (query.trim().length < MIN_QUERY) return null;
  const turns = parseTranscript(transcript ?? "");
  const matches = findMatches(turns, query);
  if (matches.length === 0) return null;

  return {
    ...call,
    matches: matches.length,
    snippet: snippetFor(turns, matches[0]),
  };
}

/** The words around one match, cut to a readable width. */
export function snippetFor(
  turns: ReadonlyArray<{ speaker: string; paragraphs: string[] }>,
  match: TranscriptMatch,
): Snippet | null {
  const turn = turns[match.turn];
  if (!turn) return null;

  // A match on the speaker's name has no paragraph to quote. The name is the
  // answer in that case, so the snippet is the start of what they said.
  const paragraph = match.paragraph >= 0 ? turn.paragraphs[match.paragraph] : turn.paragraphs[0];
  if (typeof paragraph !== "string") return null;

  if (match.paragraph < 0) {
    const head = paragraph.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER);
    return {
      speaker: turn.speaker,
      parts: [{ value: head.length < paragraph.length ? `${head}${ELLIPSIS}` : head, match: false }],
    };
  }

  const from = Math.max(0, match.start - SNIPPET_BEFORE);
  const to = Math.min(paragraph.length, match.end + SNIPPET_AFTER);

  const parts: Array<{ value: string; match: boolean }> = [];
  const lead = (from > 0 ? ELLIPSIS : "") + paragraph.slice(from, match.start);
  if (lead) parts.push({ value: lead, match: false });
  parts.push({ value: paragraph.slice(match.start, match.end), match: true });
  const tail = paragraph.slice(match.end, to) + (to < paragraph.length ? ELLIPSIS : "");
  if (tail) parts.push({ value: tail, match: false });

  return { speaker: turn.speaker, parts };
}

// WHERE THE SUMMARY WENT. `archiveSummary` lived here and said "3 calls mention
// “valuation”" — counting calls rather than mentions, because "which call was
// that in" is the question and 214 mentions answers one nobody asked. It could
// not say that the search had stopped early, so the page carried a second
// sentence underneath for that, which is a caveat somebody can read past.
//
// It is now `searchSummary` in session-archive.ts, shared with the meeting log,
// which folds the bound into the same statement.

/**
 * The three formatters `callWhen` needs, each built ONCE.
 *
 * `toLocaleTimeString` / `toLocaleDateString` with an options object look free
 * and are not. This is two of them per row, and the page re-renders on every
 * character typed into its search box: measured over the fifty rows shown at
 * rest, 5.29ms per keystroke against 0.15ms for the same fifty through reused
 * formatters. A search can return up to `SEARCH_SCAN` rows, where the same
 * arithmetic is 21ms — past a whole frame, to redraw dates that did not change.
 *
 * Three rather than one because the options differ: a time, a date inside this
 * year, and a date that needs its year spelled out.
 */
const CALL_TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const CALL_DATE_THIS_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const CALL_DATE_WITH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * When a call happened, as a person would say it.
 *
 * The date alone is not enough — somebody who took four calls on Tuesday needs
 * the time to tell them apart, and that is exactly the day they will be
 * searching.
 */
export function callWhen(at: string, now: Date = new Date()): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  const sameDay = when.toDateString() === now.toDateString();
  const time = CALL_TIME.format(when);
  if (sameDay) return `Today, ${time}`;
  const sameYear = when.getFullYear() === now.getFullYear();
  const date = (sameYear ? CALL_DATE_THIS_YEAR : CALL_DATE_WITH_YEAR).format(when);
  return `${date}, ${time}`;
}


// ── The list around the rows ────────────────────────────────────────────────

/** A recording row as the archive reads it, for choosing which one to show. */
export interface RecordingRow {
  id?: string | null;
  duration_seconds: number | null;
  deleted_at: string | null;
}

/**
 * The recording a call is represented by: the longest surviving one.
 *
 * Not the first: a call stopped and restarted has several, and the first may be
 * the eight seconds before somebody realised the mic was muted. Deleted ones are
 * skipped — their duration describes bytes that are gone, and playing one is a
 * 410. Shared by the page and the route so the row that plays a recording and
 * the length printed beside it are always about the same one.
 */
export function longestRecording(
  recordings: readonly RecordingRow[] | null | undefined,
): { id: string | null; seconds: number } | null {
  let best: { id: string | null; seconds: number } | null = null;
  for (const rec of recordings ?? []) {
    if (rec.deleted_at) continue;
    const seconds = rec.duration_seconds;
    if (typeof seconds !== "number" || seconds <= 0) continue;
    if (best === null || seconds > best.seconds) best = { id: rec.id ?? null, seconds };
  }
  return best;
}

/** How far back the archive is read. */
export type CallRange = "all" | "7d" | "30d" | "year";

export const CALL_RANGES: ReadonlyArray<{ id: CallRange; label: string }> = [
  { id: "all", label: "All time" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "year", label: "This year" },
];

/**
 * The earliest moment a range covers, as an ISO string; null for all time.
 *
 * "This year" is the reader's own calendar year, which is why this runs in the
 * browser with the browser's clock rather than on the server in UTC.
 */
export function rangeStart(range: CallRange, now: Date = new Date()): string | null {
  if (range === "7d") return new Date(now.getTime() - 7 * 86_400_000).toISOString();
  if (range === "30d") return new Date(now.getTime() - 30 * 86_400_000).toISOString();
  if (range === "year") return new Date(now.getFullYear(), 0, 1).toISOString();
  return null;
}

/** The narrowing the chips apply to calls already loaded. */
export interface CallChips {
  withSummary: boolean;
  withRecording: boolean;
}

/**
 * Whether a call passes the chips.
 *
 * Applied in the browser to what is loaded, not sent to the server: both facts
 * are already on every row, and the server's narrowing is about which calls to
 * read, not which of them to draw.
 */
export function passesChips(call: ArchivedCall, chips: CallChips): boolean {
  if (chips.withSummary && !call.summary) return false;
  if (chips.withRecording && !(call.durationSeconds && call.durationSeconds > 0)) return false;
  return true;
}

/** A run of calls under one heading. */
export interface CallGroup<T extends ArchivedCall> {
  key: string;
  label: string;
  calls: T[];
}

const GROUP_MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const GROUP_MONTH_THIS_YEAR = new Intl.DateTimeFormat("en-US", { month: "long" });

/**
 * The calls under headings a person scans by: Today, Yesterday, Earlier this
 * week, Earlier this month, then one heading per month.
 *
 * Calls arrive newest first and stay in that order; a heading starts wherever
 * the label changes. Days are the reader's local days, measured against `now`
 * — passed in, for the same reason `callWhen` takes it: a memoized list left
 * open past midnight must re-label, not keep yesterday's "Today".
 */
export function groupCalls<T extends ArchivedCall>(calls: readonly T[], now: Date = new Date()): CallGroup<T>[] {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const weekAgo = today - 6 * 86_400_000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const out: CallGroup<T>[] = [];
  for (const call of calls) {
    const when = new Date(call.at);
    let key: string;
    let label: string;
    if (Number.isNaN(when.getTime())) {
      key = "undated";
      label = "Undated";
    } else {
      const day = startOfDay(when);
      if (day >= today) { key = "today"; label = "Today"; }
      else if (day >= yesterday) { key = "yesterday"; label = "Yesterday"; }
      else if (day >= weekAgo) { key = "week"; label = "Earlier this week"; }
      else if (day >= monthStart) { key = "month"; label = "Earlier this month"; }
      else {
        key = `${when.getFullYear()}-${when.getMonth()}`;
        label = (when.getFullYear() === now.getFullYear() ? GROUP_MONTH_THIS_YEAR : GROUP_MONTH).format(when);
      }
    }
    const last = out[out.length - 1];
    if (last && last.key === key) last.calls.push(call);
    else out.push({ key, label, calls: [call] });
  }
  return out;
}

/** What the header says about recent recording, when there is any. */
export interface CallStats {
  /** Calls in the window. */
  count: number;
  /** Seconds recorded across them, longest recording per call. */
  seconds: number;
  /** The window, in days. */
  days: number;
}

/**
 * A total length the way a person says it: "4h 10m", "25m", "under a minute".
 */
export function totalRecorded(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return total > 0 ? "under a minute" : "0m";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** The header line, or null when there is nothing worth saying. */
export function statsLine(stats: CallStats | null | undefined): string | null {
  if (!stats || stats.count <= 0) return null;
  const calls = `${stats.count} call${stats.count === 1 ? "" : "s"}`;
  return `Last ${stats.days} days: ${calls} · ${totalRecorded(stats.seconds)} recorded`;
}

/** The longest title a call can be given. */
export const CALL_TITLE_MAX = 120;

/** A title as typed, cleaned; null when it would be empty. */
export function cleanCallTitle(input: string): string | null {
  const t = input.replace(/\s+/g, " ").trim().slice(0, CALL_TITLE_MAX);
  return t ? t : null;
}
