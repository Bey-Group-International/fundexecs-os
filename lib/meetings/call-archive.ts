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

/**
 * What the archive says about a search.
 *
 * Says how many CALLS matched rather than how many times the word appears,
 * because that is the question being asked — "which call was that in" — and a
 * count of 214 mentions across three calls answers a question nobody asked.
 */
export function archiveSummary(query: string, calls: number): string {
  const q = query.trim();
  if (q.length === 0) return "";
  if (q.length < MIN_QUERY) return `Type at least ${MIN_QUERY} characters`;
  if (calls === 0) return `No calls mention “${q}”`;
  return `${calls} call${calls === 1 ? "" : "s"} mention${calls === 1 ? "s" : ""} “${q}”`;
}

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
  const time = when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  const sameYear = when.getFullYear() === now.getFullYear();
  const date = when.toLocaleDateString("en-US",
    sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return `${date}, ${time}`;
}
