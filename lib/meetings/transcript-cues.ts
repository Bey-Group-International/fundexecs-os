// lib/meetings/transcript-cues.ts
// Putting the transcript on the recording's clock.
//
// The transcript is stored twice over: as the rendered text a report is built
// from, and as the rows the room wrote while people were speaking. Only the
// rows carry a time, and a time is the whole difference between a transcript
// you read and one you can use — "she said that at 34 minutes" is findable,
// "she said that somewhere in this hour" is not.
//
// So turns are built from the rows rather than re-parsed out of the text. That
// is not only more accurate, it is less work: the text had to have its speaker
// prefixes and confidence markers written and then read back, and the rows have
// never stopped being structured.
//
// Pure. The rows are loaded by whoever is rendering.

/** A stored transcript row, as the table holds it. */
export interface CueRow {
  speaker: string | null;
  text: string;
  ts: string;
  confidence?: number | null;
  overlapped?: boolean | null;
}

/** One speaker's turn, placed on the recording's clock. */
export interface TranscriptCue {
  speaker: string;
  /** Milliseconds from the start of the recording. Negative is clamped to 0. */
  atMs: number;
  uncertain: boolean;
  overlapped: boolean;
  paragraphs: string[];
}

/** Below this, the room said it was not sure who spoke. Matches the room's own bar. */
const CONFIDENT_ENOUGH = 0.6;

/**
 * Group stored rows into turns, timed against the recording's start.
 *
 * Consecutive rows from the same speaker become one turn, the way the rendered
 * transcript reads them — a person speaking for a minute is one turn, not
 * fifteen events. The turn's time is the time of its FIRST row, because that is
 * the moment somebody clicking it wants to land on.
 *
 * A recording that started after the meeting did (a host who pressed Record
 * halfway through) puts early turns at a negative offset. Those are kept and
 * clamped to zero rather than dropped: the words were still said, and the
 * nearest moment the recording holds is its beginning.
 */
export function transcriptCues(
  rows: readonly CueRow[] | null | undefined,
  recordingStartedAt: string | null | undefined,
): TranscriptCue[] {
  const origin = Date.parse(recordingStartedAt ?? "");
  const base = Number.isFinite(origin) ? origin : NaN;

  const ordered = [...(rows ?? [])]
    .filter((r) => r && typeof r.text === "string" && r.text.trim().length > 0)
    .map((r) => ({ ...r, at: Date.parse(r.ts) }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => a.at - b.at);

  const out: TranscriptCue[] = [];
  for (const row of ordered) {
    const speaker = (row.speaker ?? "").trim();
    const uncertain = typeof row.confidence === "number" && row.confidence < CONFIDENT_ENOUGH;
    const overlapped = row.overlapped === true;
    const text = row.text.trim();

    const last = out[out.length - 1];
    // Merged only while the speaker AND what the room said about them hold: a
    // turn that becomes uncertain halfway through is two different claims.
    if (last && last.speaker === speaker && last.uncertain === uncertain && last.overlapped === overlapped) {
      last.paragraphs.push(text);
      continue;
    }

    out.push({
      speaker,
      atMs: Number.isFinite(base) ? Math.max(0, row.at - base) : 0,
      uncertain,
      overlapped,
      paragraphs: [text],
    });
  }

  return out;
}

/** Whether these cues can usefully drive a player — they need a real clock. */
export function cuesAreTimed(cues: readonly TranscriptCue[]): boolean {
  return cues.length > 1 && cues.some((c) => c.atMs > 0);
}
