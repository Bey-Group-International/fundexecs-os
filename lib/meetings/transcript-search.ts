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
  /**
   * Index into that turn's paragraphs, or SPEAKER for the speaker's name.
   *
   * The name is searchable because it always was: the filter this replaced
   * matched on it, and "what did Priya say" is one of the two things anybody
   * searches a transcript for. It is a separate slot rather than a paragraph
   * so the caller can paint it in the column where the name actually is.
   */
  paragraph: number;
  /** Character offsets within that text. */
  start: number;
  end: number;
}

/** The `paragraph` of a match found in the speaker's name rather than in prose. */
export const SPEAKER = -1;

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
    // The speaker first, because that is reading order: the name sits to the
    // left of the words, and a reader stepping through hits expects them in
    // the order they appear.
    locate(turn?.speaker ?? "", needle).forEach(([start, end]) => {
      out.push({ turn: t, paragraph: SPEAKER, start, end });
    });
    turn?.paragraphs?.forEach((paragraph, p) => {
      locate(paragraph ?? "", needle).forEach(([start, end]) => {
        out.push({ turn: t, paragraph: p, start, end });
      });
    });
  });
  return out;
}

/**
 * Every occurrence of a lowercased needle in one piece of text, as offsets
 * into the ORIGINAL.
 *
 * The obvious version searches `text.toLowerCase()` and hands back those
 * offsets, which is wrong for any character whose lowercase is longer than it
 * is — "İ" (U+0130) lowercases to two code units, so every match after one in
 * the same paragraph is painted a character to the left, over the wrong
 * letters. Rare, and a renderer that highlights the wrong characters of a
 * meeting record is still a renderer that misquotes people.
 *
 * So the lowercase is built alongside a map back to the source index that
 * produced each unit, and the offsets are translated through it.
 */
function locate(text: string, needle: string): Array<[number, number]> {
  if (!text) return [];

  let hay = "";
  const source: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const lower = text[i].toLowerCase();
    hay += lower;
    for (let k = 0; k < lower.length; k++) source.push(i);
  }

  const out: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    // The end is taken from the LAST unit consumed, plus one, so a match that
    // ends inside an expanded character still covers that whole character
    // rather than collapsing to nothing.
    out.push([source[at], source[at + needle.length - 1] + 1]);
    from = at + needle.length;
  }
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
  return partsFor(text, groupMatches(matches).get(slot(turn, paragraph)));
}

/** One located match, carrying its place in the list the reader steps through. */
export interface PlacedMatch {
  match: TranscriptMatch;
  index: number;
}

/** Where a match belongs: one turn's speaker name, or one of its paragraphs. */
function slot(turn: number, paragraph: number): string {
  return `${turn}:${paragraph}`;
}

/**
 * The match list, bucketed by the text each match sits in.
 *
 * Built once per search rather than rescanned per paragraph. The panel renders
 * every paragraph on every playhead tick, so the naive version is the whole
 * match list walked once per paragraph per second.
 */
export function groupMatches(matches: readonly TranscriptMatch[]): Map<string, PlacedMatch[]> {
  const out = new Map<string, PlacedMatch[]>();
  matches.forEach((match, index) => {
    const key = slot(match.turn, match.paragraph);
    const bucket = out.get(key);
    if (bucket) bucket.push({ match, index });
    else out.set(key, [{ match, index }]);
  });
  return out;
}

/** The parts of one piece of text, given only the matches that fall inside it. */
export function partsFor(text: string, mine: readonly PlacedMatch[] | undefined): TextPart[] {
  const source = text ?? "";
  if (!mine || mine.length === 0) {
    return source ? [{ value: source, match: false, index: -1 }] : [];
  }

  const out: TextPart[] = [];
  let cursor = 0;
  for (const { match, index } of mine) {
    if (match.start > cursor) {
      out.push({ value: source.slice(cursor, match.start), match: false, index: -1 });
    }
    out.push({ value: source.slice(match.start, match.end), match: true, index });
    cursor = match.end;
  }
  if (cursor < source.length) out.push({ value: source.slice(cursor), match: false, index: -1 });
  return out;
}

/** The matches for one piece of text, from a grouped list. */
export function matchesIn(
  grouped: Map<string, PlacedMatch[]>,
  turn: number,
  paragraph: number,
): PlacedMatch[] | undefined {
  return grouped.get(slot(turn, paragraph));
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
