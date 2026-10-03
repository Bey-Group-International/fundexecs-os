// lib/meetings/report-moments.ts
// Where in the recording a line of the report was said, and links to moments.
//
// The report's decisions, key points and action items are the model's words,
// not quotes, so there is no timestamp on them to read. But they are almost
// always made of the words somebody used — "send the valuation memo by Friday"
// comes from a turn that says "valuation", "memo" and "Friday". So a line is
// placed at the turn that shares the most of its distinctive words, and only
// when the overlap is strong enough to be a match rather than a coincidence:
// a chip that plays the wrong minute is worse than no chip.
//
// Pure: no DOM, no React.

import type { TranscriptCue } from "@/lib/meetings/transcript-cues";

/** Words too common to say anything about where a line came from. */
const STOP = new Set(
  (
    "about after again also back been before being both could does doing done down each even every from " +
    "going have having here into just know like made make many more most much must need next only other " +
    "over really said same should some still such sure take than that their them then there these they " +
    "thing things think this those through very want were what when where which while will with would " +
    "your yours yeah okay right well we'll we're they're it's that's i'll i'm you're don't can't won't"
  ).split(" "),
);

/** The distinctive words of a line: lower-cased, four letters or more, no stop words. */
export function momentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? []) {
    const w = raw.replace(/[’']s$/, "").replace(/[’'-]/g, "");
    if (w.length < 4 || STOP.has(raw) || STOP.has(w)) continue;
    // A crude stem, so "memos" meets "memo", "sending" meets "send" and
    // "agreed" meets "agree".
    // The final "e" first, so "agree" and "agreed" both come to "agre".
    const stem = w.replace(/e$/, "").replace(/(ing|ed|es|s)$/, "");
    out.add(stem.length >= 3 ? stem : w);
  }
  return out;
}

/** How much of a line's vocabulary a turn must share to be its source. */
const MIN_SHARE = 0.5;
/** And never on fewer words than this, however short the line. */
const MIN_WORDS = 2;

/**
 * The moment a line of the report was most likely said, in milliseconds from
 * the start of the recording; null when no turn is a convincing match.
 *
 * The earliest of equally good turns: a decision is usually stated once and
 * then repeated, and the first time is where the discussion that led to it is.
 */
export function momentFor(text: string, cues: readonly TranscriptCue[]): number | null {
  const want = momentWords(text);
  if (want.size < MIN_WORDS) return null;
  let best: { at: number; hits: number } | null = null;
  for (const { cue, have } of indexOf(cues)) {
    let hits = 0;
    for (const w of want) if (have.has(w)) hits++;
    if (hits < MIN_WORDS || hits / want.size < MIN_SHARE) continue;
    if (!best || hits > best.hits || (hits === best.hits && cue.atMs < best.at)) best = { at: cue.atMs, hits };
  }
  return best ? best.at : null;
}

/**
 * Each turn's words, worked out once per transcript. The page places every
 * decision, key point and action item against the same turns, and an hour of
 * meeting is a few hundred of them.
 */
const INDEX = new WeakMap<readonly TranscriptCue[], Array<{ cue: TranscriptCue; have: Set<string> }>>();
function indexOf(cues: readonly TranscriptCue[]) {
  let index = INDEX.get(cues);
  if (!index) {
    index = cues.map((cue) => ({ cue, have: momentWords(cue.paragraphs.join(" ")) }));
    INDEX.set(cues, index);
  }
  return index;
}

/** A clock for a moment: "4:05", "1:02:09". */
export function momentClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * The moment a link asks for, from its `t` parameter, in milliseconds.
 *
 * Accepts what people paste and what other players write: plain seconds
 * ("754"), a clock ("12:34", "1:02:09") and the "12m34s" form. Null for
 * anything else, including a negative time.
 */
export function momentFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("t");
  if (!raw) return null;
  const t = raw.trim();
  let seconds: number | null = null;
  if (/^\d+(\.\d+)?$/.test(t)) seconds = Number(t);
  else if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
    seconds = t.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
  } else {
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
    if (m && (m[1] || m[2] || m[3])) seconds = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  }
  return seconds === null || !Number.isFinite(seconds) || seconds < 0 ? null : Math.round(seconds * 1000);
}

/**
 * A link to this report, opened on the recording at a moment.
 *
 * Whole seconds: a link is for a person, and "754" survives being read out
 * where "754312" does not. The hash opens the recording tab.
 */
export function momentLink(href: string, ms: number): string {
  const url = new URL(href);
  url.searchParams.set("t", String(Math.max(0, Math.floor(ms / 1000))));
  url.hash = "recording";
  return url.toString();
}

/** The event a moment chip sends, and the media panel listens for. */
export const SEEK_EVENT = "report:seek";

export interface SeekDetail {
  ms: number;
  /** Start playing once there, which is what a person pressing "play from" means. */
  play: boolean;
}
