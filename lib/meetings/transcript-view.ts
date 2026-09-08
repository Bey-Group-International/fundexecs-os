// lib/meetings/transcript-view.ts
// Reading a saved transcript back into turns.
//
// A transcript is stored as the lines the room produced — "Alina: Morning
// everyone", one per utterance, with an "(uncertain)" note where attribution
// was not confident. That is a good thing to store and a bad thing to show:
// rendered straight, it is an undifferentiated wall of monospace where the only
// way to find who said what is to read every line.
//
// This turns those lines back into turns, so they can be typeset: who spoke,
// what they said, and whether the room was sure it was them. Consecutive lines
// from one speaker become one turn, because a person saying three sentences is
// one person speaking, not three events.
//
// Pure: no DOM. The parsing rules are the interesting part and they are tested.

/** The note formatTranscriptLine appends when attribution was not confident. */
const OVERLAP_NOTE = "people speaking over each other";

/**
 * The longest a speaker label may be.
 *
 * A transcript line is "Name: what they said", but what they said can contain a
 * colon of its own — "The question is this: do we hold the close". Without a
 * ceiling, that sentence becomes a speaker called "The question is this".
 */
const MAX_SPEAKER_LENGTH = 60;

/**
 * And the most words. A name is a name; a clause is longer.
 *
 * Four covers "Dr Alina Marie Reyes" and stops well short of "That settles it,
 * then" — which is exactly the sentence that got read as a speaker before this
 * was tightened.
 */
const MAX_SPEAKER_WORDS = 4;

export interface TranscriptTurn {
  /** The speaker's name, or "" when the line carried none. */
  speaker: string;
  /** Attribution was flagged as not confident. */
  uncertain: boolean;
  /** Specifically: somebody else was audible at the same time. */
  overlapped: boolean;
  /** What they said, one entry per line that was merged into this turn. */
  paragraphs: string[];
}

/** A candidate speaker label, or null when the prefix is really just prose. */
function readSpeaker(prefix: string): string | null {
  const name = prefix.trim();
  if (!name || name.length > MAX_SPEAKER_LENGTH) return null;
  // Prose ends in sentence punctuation; names do not.
  if (/[.!?]$/.test(name)) return null;
  // Nor do they contain a clause break. Names in this product come from
  // attendee records and sign-ins — "First Last", or an address.
  if (/[,;]/.test(name)) return null;
  if (name.split(/\s+/).length > MAX_SPEAKER_WORDS) return null;
  return name;
}

/**
 * Split a stored transcript into turns.
 *
 * Tolerant by design. This text has been through a model's context window, an
 * export, and possibly a copy and paste, and a line that does not parse is
 * still something somebody said — so it is kept as prose under whoever was
 * speaking last, rather than dropped or shown as a speaker called nothing.
 */
export function parseTranscript(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];

  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // "Name: said" or "Name (uncertain — …): said".
    const match = /^([^:]{1,80}?)(?:\s*\(([^)]{0,120})\))?\s*:\s+(.+)$/.exec(line);
    const speaker = match ? readSpeaker(match[1]) : null;

    if (!speaker) {
      // Unparseable, or a line that is simply prose. Attach it to the turn in
      // progress; start an unattributed one if there is nothing to attach to.
      const last = turns[turns.length - 1];
      if (last) last.paragraphs.push(line);
      else turns.push({ speaker: "", uncertain: false, overlapped: false, paragraphs: [line] });
      continue;
    }

    const note = (match![2] ?? "").trim();
    const uncertain = note.length > 0;
    const overlapped = note.includes(OVERLAP_NOTE);
    const said = match![3].trim();

    // One person saying three sentences is one person speaking, not three
    // events — but only while the confidence note stays the same, or the marker
    // would claim more or less than the room actually reported.
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker && last.uncertain === uncertain && last.overlapped === overlapped) {
      last.paragraphs.push(said);
    } else {
      turns.push({ speaker, uncertain, overlapped, paragraphs: [said] });
    }
  }

  return turns;
}

/** The distinct speakers, in the order they first spoke. */
export function transcriptSpeakers(turns: TranscriptTurn[]): string[] {
  const seen: string[] = [];
  for (const turn of turns) {
    if (turn.speaker && !seen.includes(turn.speaker)) seen.push(turn.speaker);
  }
  return seen;
}

/**
 * Up to two initials for a speaker chip.
 *
 * An address falls back to its first letter: "ray@example.com" as "RA" would be
 * reading the local part as a name, which it is not.
 */
export function speakerInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  if (clean.includes("@")) return clean[0].toUpperCase();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Rough word count, for the header that says how long this is. */
export function transcriptWordCount(turns: TranscriptTurn[]): number {
  return turns.reduce(
    (n, turn) => n + turn.paragraphs.reduce((m, p) => m + p.split(/\s+/).filter(Boolean).length, 0),
    0,
  );
}
