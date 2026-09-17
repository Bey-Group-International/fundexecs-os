// lib/meetings/transcript-restore.ts
// Rebuilding a meeting's transcript from the rows it left behind.
//
// The report used to be built from one source only: whatever the host's browser
// still held in memory when they pressed End. That made the whole record
// contingent on one tab surviving to the end of the call. A crash, a reload, a
// closed laptop, a phone that rang — and the meeting was gone, with no trace in
// the product that it had ever produced words.
//
// The rows were there the whole time. `live_meeting_transcripts` was written on
// a timer through the entire call and read by nothing, anywhere, ever: a backup
// that had never once been restored. This is the restore.
//
// Pure: rows in, transcript text out. The interesting decisions are which
// record to trust and how to cut one down to size, and both are testable.

import { formatTranscriptLine } from "@/lib/meetings/speaker-attribution";

/** A stored line, as `live_meeting_transcripts` hands it back. */
export interface StoredLine {
  speaker: string | null;
  text: string;
  ts: string;
  confidence: number | null;
  overlapped: boolean | null;
}

/**
 * Render stored rows as the transcript text the report model reads.
 *
 * Ordered by when the words were SPOKEN, not by when they were saved. Different
 * participants flush on their own timers, so insertion order is the order their
 * networks happened to answer in — which would hand the model a conversation
 * whose turns are shuffled, and it would dutifully summarise it that way.
 *
 * A row with no confidence recorded is treated as confident: those rows predate
 * attribution, and marking every one of them doubtful would put "(uncertain)"
 * against every line of every meeting held before it existed.
 */
export function restoreTranscript(rows: readonly StoredLine[]): string {
  return [...rows]
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .map((r) =>
      formatTranscriptLine({
        speaker: r.speaker ?? "",
        text: r.text,
        confidence: r.confidence ?? 1,
        overlapped: r.overlapped ?? false,
      }),
    )
    .join("\n");
}

/** How many transcript lines a block of text holds. */
export function transcriptLineCount(text: string): number {
  return (text ?? "").split("\n").filter((l) => l.trim().length > 0).length;
}

/**
 * Split a rendered transcript into the lines that carry words.
 *
 * Blank lines are dropped rather than preserved: they are formatting, they are
 * not the same on both sides, and a blank matching a blank would make two
 * records look like they overlap when they share nothing.
 */
function textLines(text: string): string[] {
  return (text ?? "").split("\n").filter((l) => l.trim().length > 0);
}

/**
 * Combine the transcript the room posted with the one on file.
 *
 * This used to pick a winner — whichever held more lines — and throw the other
 * away whole. Both directions of that lost words, because neither copy is a
 * superset of the other:
 *
 *   - The database can hold MORE. The host reloaded, or joined late, or their
 *     tab died and the report is being regenerated: their memory holds a
 *     fragment of a call the rows remember from the beginning.
 *   - The posted copy can hold more. A participant whose writes were failing
 *     still broadcast their words to everyone else, so the host heard lines
 *     that never reached the table. It also holds the final seconds, spoken
 *     after the last flush and after the last row was ever written.
 *
 * So picking the longer one discarded the END of a meeting in exactly the case
 * the restore exists for. A host whose tab reloaded got the stored copy, which
 * is fuller and is missing everything said after the last flush — and the last
 * thing said in a meeting is usually what it decided.
 *
 * The merge that replaces it is deliberately the narrow one. Both copies are
 * rendered by the same formatter and both run in the order the words were
 * spoken, so an identical line is the same utterance and shared lines anchor
 * the two records against each other. What the fuller copy is missing is what
 * sits OUTSIDE those anchors: a run at the start, a run at the end, or both.
 * Those runs can be placed with certainty — before everything shared, or after
 * it — so they are recovered.
 *
 * What is deliberately NOT recovered is a line the fuller copy is missing from
 * its middle. Between two anchors there is no way to tell where it goes, its
 * neighbours are already present, and guessing would reorder a conversation
 * the model then reads as a different meeting. That case also barely happens:
 * a write fails for a stretch, not for one sentence in the middle of a run.
 *
 * Counting lines rather than characters to choose the spine, because a
 * duplicated record is longer than a correct one and length would reward
 * exactly the bug this file replaced.
 */
export function mergeTranscripts(posted: string, stored: string): string {
  const postedLines = textLines(posted);
  const storedLines = textLines(stored);
  if (postedLines.length === 0) return stored;
  if (storedLines.length === 0) return posted;

  const spine = storedLines.length > postedLines.length ? storedLines : postedLines;
  const other = spine === storedLines ? postedLines : storedLines;
  const inSpine = new Set(spine);

  const first = other.findIndex((l) => inSpine.has(l));
  // No line in common. The two records cannot be placed against each other at
  // all, so there is nothing to recover and nowhere to put it: keep the fuller
  // one, which is what this did before the merge existed.
  if (first === -1) return spine.join("\n");

  let last = other.length - 1;
  while (last > first && !inSpine.has(other[last])) last -= 1;

  const head = other.slice(0, first);
  const tail = other.slice(last + 1);
  if (head.length === 0 && tail.length === 0) return spine.join("\n");
  return [...head, ...spine, ...tail].join("\n");
}
