// lib/meetings/transcript-search.ts
// Finding a word in an hour of talking.
//
// The panel had a search box that filtered turns to the ones containing the
// query, and stopped there. Three things follow from that, and each is worse
// than the last:
//
//   The match was never shown. Searching "valuation" returned eight turns and
//   left you reading all of them to find the word — which is the task you
//   opened the search box to avoid.
//
//   There was no count and nowhere to go. A word said nine times in an hour is
//   nine results you scroll past each other looking for the one you meant.
//
//   And filtering DELETED the conversation around the hit, which is the part
//   that makes a hit mean anything. "Yes, about forty" is not an answer until
//   you can see the question above it.
//
// So this does not filter. It locates: every match, in order, with the span
// inside its paragraph — enough for the caller to highlight them in place, say
// how many there are, and step between them without the transcript moving out
// from under the reader.
//
// Pure: no React, no DOM, no scroll.

/** Anything with the shape the panel renders, cue or parsed turn alike. */
export interface SearchableTurn {
  speaker: string;
  paragraphs: string[];
}

/** One hit, located precisely enough to be painted where it sits. */
export interface TranscriptMatch {
  /** Index into the turns array. */
  turn: number;
  /** Index into that turn's paragraphs. */
  paragraph: number;
  /** Character offsets within the paragraph. */
  start: number;
  end: number;
}

/**
 * The shortest query worth running.
 *
 * One character matches most of a transcript, which is not a search result —
 * it is the whole document with stripes on. Two is the shortest thing anybody
 * means ("AI", "Q3", a pair of initials).
 */
export const MIN_QUERY = 2;

/**
 * Every occurrence of `query`, in reading order.
 *
 * Case-insensitive and literal: the query is somebody's recollection of what
 * was said, not a pattern, so regular-expression characters in it are
 * characters. Overlapping matches are not reported twice — "aa" in "aaa" is one
 * match and then another, which is what a reader stepping through them expects.
 */
export function findMatches(
  turns: readonly SearchableTurn[] | null | undefined,
  query: string,
): TranscriptMatch[] {
  const needle = (query ?? "").trim().toLowerCase();
  if (needle.length < MIN_QUERY) return [];

  const out: TranscriptMatch[] = [];
  (turns ?? []).forEach((turn, t) => {
    turn?.paragraphs?.forEach((paragraph, p) => {
      const hay = (paragraph ?? "").toLowerCase();
      let from = 0;
      for (;;) {
        const at = hay.indexOf(needle, from);
        if (at === -1) break;
        out.push({ turn: t, paragraph: p, start: at, end: at + needle.length });
        from = at + needle.length;
      }
    });
  });
  return out;
}

/** A paragraph cut into the parts that matched and the parts that did not. */
export interface TextPart {
  value: string;
  match: boolean;
  /** Index into the whole transcript's match list, for the active one. */
  index: number;
}

/**
 * One paragraph, split around the matches inside it.
 *
 * Parts rather than markup, for the same reason the chat renders parts: the
 * caller builds React nodes, so nothing here can put HTML on a page, and this
 * is other people's words.
 *
 * `matches` is the whole transcript's list and `turn`/`paragraph` say which
 * slice of it belongs here — so the index carried on each part is the index a
 * reader is stepping through, not a number local to this line.
 */
export function splitParagraph(
  text: string,
  matches: readonly TranscriptMatch[],
  turn: number,
  paragraph: number,
): TextPart[] {
  const source = text ?? "";
  const mine: Array<{ m: TranscriptMatch; index: number }> = [];
  matches.forEach((m, index) => {
    if (m.turn === turn && m.paragraph === paragraph) mine.push({ m, index });
  });
  if (mine.length === 0) return source ? [{ value: source, match: false, index: -1 }] : [];

  const out: TextPart[] = [];
  let cursor = 0;
  for (const { m, index } of mine) {
    if (m.start > cursor) out.push({ value: source.slice(cursor, m.start), match: false, index: -1 });
    out.push({ value: source.slice(m.start, m.end), match: true, index });
    cursor = m.end;
  }
  if (cursor < source.length) out.push({ value: source.slice(cursor), match: false, index: -1 });
  return out;
}

/**
 * Step to the next or previous match, wrapping at the ends.
 *
 * Wrapping because a reader who reaches the last hit and presses again means
 * "show me the first one", not "do nothing" — and a search box that stops
 * responding reads as broken rather than as finished.
 */
export function stepMatch(current: number, total: number, by: 1 | -1): number {
  if (total <= 0) return -1;
  if (current < 0) return by === 1 ? 0 : total - 1;
  return (current + by + total) % total;
}

/**
 * How the count reads under the box.
 *
 * Said in words rather than as "3/17", because the panel is read by people who
 * are not looking for a ratio — and because a screen reader says "three of
 * seventeen" and "three slash seventeen" very differently.
 */
export function matchSummary(current: number, total: number, query: string): string {
  const needle = (query ?? "").trim();
  if (needle.length === 0) return "";
  if (needle.length < MIN_QUERY) return `Type at least ${MIN_QUERY} characters`;
  if (total === 0) return "No matches";
  const at = current < 0 ? 1 : current + 1;
  return `${at} of ${total}`;
}
