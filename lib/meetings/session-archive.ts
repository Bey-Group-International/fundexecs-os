// lib/meetings/session-archive.ts
// Finding a past session by what happened in it.
//
// Two pages were asking the same question of the same table and answering it in
// opposite ways.
//
// The recorded-call archive (/meetings/calls) reads TRANSCRIPTS, in Postgres,
// bounded, and says so when the bound bites. The meeting log (on /meetings)
// matched titles, summaries and attendee names with `String.includes` in the
// browser, over every entry it had been handed — so it could not answer the
// question people actually bring to a log ("what did we agree with Dunbar in
// March"), and it needed every summary in the initial payload to answer the
// questions it could.
//
// They differ by one column: `kind`. So the engine is shared and the two things
// that genuinely differ are PARAMETERS.
//
// VISIBILITY IS ONE OF THEM, deliberately. A recorded call belongs to the person
// who recorded it; a meeting is listed across the organisation. Sharing the
// engine must not quietly share the permission rule — somebody's call becoming
// org-visible because two lists were merged is not a refactor, it is a
// disclosure. So the rule travels as data, and every caller states which one it
// wants.

import { MIN_QUERY, findMatches, type TranscriptMatch } from "@/lib/meetings/transcript-search";
import { parseTranscript } from "@/lib/meetings/transcript-view";
import { snippetFor, type Snippet } from "@/lib/meetings/call-archive";

/**
 * Who may see a session.
 *
 * Not a boolean and not inferred from the kind: written out so a reader of a
 * call site can see which rule is being applied without knowing what kind
 * implies what.
 */
export type SessionVisibility =
  /** Only sessions this person hosted. What a recorded call is. */
  | { scope: "host"; hostId: string }
  /** Every session in the organisation. What a meeting is. */
  | { scope: "org"; organizationId: string };

/** The fields every archived session shows in a list row. */
export interface ArchivedSession {
  id: string;
  roomCode: string;
  title: string;
  /** When it happened — not when the row was made. */
  at: string;
  /** Who was there, when the session records it. Empty for a one-way call. */
  attendeeNames: string[];
  /** Minutes, from the meeting's own clock. Null when it never ran. */
  durationMinutes: number | null;
  /** Seconds, from the recording's parts. Null when nothing was recorded. */
  durationSeconds: number | null;
  /** A report row exists. Not the same as it having a summary. */
  hasReport: boolean;
}

/**
 * Why a session matched.
 *
 * Kept as a reason rather than a boolean, because the two are worth telling
 * apart in the result: a hit on the title is something the reader can already
 * see in the row, and a hit in the transcript is a sentence they have not read
 * and want quoted.
 */
export type MatchReason = "metadata" | "transcript";

/** A session that matched a search. */
export interface SessionHit extends ArchivedSession {
  reason: MatchReason;
  /** How many times the query appears in the transcript. Zero for a metadata hit. */
  matches: number;
  /** The sentence around the first transcript hit. Null for a metadata hit. */
  snippet: Snippet | null;
}

/**
 * What one search read, and whether it saw everything.
 *
 * `scanned` and `bounded` exist so a search can admit its own limits. A
 * transcript scan is a substring match over up to 120,000 characters a row, so
 * it has to stop somewhere — and a search that stops silently is worse than one
 * that stops loudly, because "no results" and "I did not look" are the same
 * screen.
 */
export interface SessionSearchResult {
  hits: SessionHit[];
  /** Sessions whose transcripts this search actually read. */
  scanned: number;
  /** The scan limit was reached, so there may be older matches unseen. */
  bounded: boolean;
}

/**
 * The metadata a session is searchable by without reading its transcript.
 *
 * Assembled by the caller from what it already has, so this stays a pure rule.
 * Note what is NOT here: the transcript. Metadata matching is cheap and covers
 * the common case ("the Dunbar call"); transcript matching is the expensive half
 * and is asked for separately.
 */
export interface SessionMetadata {
  title: string;
  summary: string;
  keyPoints: readonly string[];
  decisions: readonly string[];
  actionItems: readonly string[];
  attendeeNames: readonly string[];
}

/**
 * Whether a session's metadata matches.
 *
 * Every term must appear somewhere, which is what makes a two-word query narrow
 * rather than widen — "dunbar valuation" should mean both, not either. This is
 * the rule the log already applied in the browser; it is here so the server can
 * apply the same one and the two cannot drift.
 */
export function matchesMetadata(meta: SessionMetadata, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    meta.title,
    meta.summary,
    ...meta.keyPoints,
    ...meta.decisions,
    ...meta.actionItems,
    ...meta.attendeeNames,
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

/**
 * Search one session: its metadata, then its transcript.
 *
 * Metadata first because it is free and because a title match is the answer
 * people expect to come back fastest. A metadata hit still reports its
 * transcript matches when there are any — somebody searching "valuation" who
 * matched the title also wants to know it was said eleven times — but it does
 * not need them to be considered a hit.
 *
 * Returns null for no match, so callers filter on it rather than checking a
 * zero-match hit they will eventually forget to check.
 */
export function searchSession(
  session: ArchivedSession,
  meta: SessionMetadata,
  transcript: string | null,
  query: string,
): SessionHit | null {
  const q = query.trim();
  if (q.length < MIN_QUERY) return null;

  const byMetadata = matchesMetadata(meta, q);

  // The transcript is read whether or not the metadata matched, because it
  // supplies the snippet and the count. It is skipped only when there is nothing
  // to read.
  let matches: TranscriptMatch[] = [];
  let snippet: Snippet | null = null;
  if (transcript && transcript.trim().length > 0) {
    const turns = parseTranscript(transcript);
    matches = [...findMatches(turns, q)];
    if (matches.length > 0) snippet = snippetFor(turns, matches[0]);
  }

  if (!byMetadata && matches.length === 0) return null;

  return {
    ...session,
    // A transcript hit is the interesting one to report even when the metadata
    // also matched, because it is the half the reader cannot already see.
    reason: matches.length > 0 ? "transcript" : "metadata",
    matches: matches.length,
    snippet,
  };
}

/**
 * How many sessions' transcripts one search will read.
 *
 * Each is up to 120,000 characters and the narrowing is a substring match
 * rather than an index, so an unbounded search over a long-lived organisation is
 * a table scan carrying a novel per row. Two hundred is a page of history deep
 * enough for the question people ask, and `bounded` says when it was not enough.
 */
export const SEARCH_SCAN = 200;

/** Sessions listed at once when nobody is searching. */
export const LIST_PAGE = 50;

/**
 * What to tell the reader about a set of results.
 *
 * The bounded case is the one that matters. "Nothing matches" over a search that
 * only read the most recent two hundred sessions is a false statement, and it is
 * the statement a naive count makes.
 */
export function searchSummary(result: {
  query: string;
  hits: number;
  scanned: number;
  bounded: boolean;
}): string {
  const q = result.query.trim();
  if (!q) return result.hits === 1 ? "1 session" : `${result.hits} sessions`;

  const found =
    result.hits === 0
      ? "No matches"
      : result.hits === 1
        ? "1 match"
        : `${result.hits} matches`;

  if (!result.bounded) return `${found} for “${q}”`;
  // Said even when there ARE hits: the reader may be looking for an older one.
  return `${found} for “${q}” in the most recent ${result.scanned} sessions`;
}

/**
 * Which half of the archive a session belongs to, as the database records it.
 *
 * The two pages are one table split on this column. Kept here so the split is
 * named in one place rather than as a literal at each query.
 */
export type SessionKind = "meeting" | "one_way";
