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
 * Choose between the transcript the room posted and the one on file.
 *
 * Neither is reliably the fuller record, so the rule is simply: take whichever
 * has more lines.
 *
 *   - The database can hold MORE. That is the case this exists for: the host
 *     reloaded, or joined late, or their tab died and the report is being
 *     regenerated — their memory holds a fragment of a call the rows remember
 *     whole.
 *   - The posted copy can hold more. A participant whose writes were failing
 *     still broadcast their words to everyone else, so the host heard lines
 *     that never reached the table. It also holds the final seconds, spoken
 *     after the last flush.
 *
 * Counting lines rather than characters, because a duplicated record is longer
 * than a correct one and length would reward exactly the bug this replaced.
 */
export function chooseTranscript(posted: string, stored: string): string {
  const postedLines = transcriptLineCount(posted);
  const storedLines = transcriptLineCount(stored);
  if (storedLines > postedLines) return stored;
  return posted.trim() ? posted : stored;
}
