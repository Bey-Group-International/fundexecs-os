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

// ── Following the recording ─────────────────────────────────────────────────
//
// Seeking was one-way. A line in the transcript could drive the player, and the
// player told nobody where it had got to — so while a recording played, the
// transcript sat exactly where the reader had left it. Watching forty minutes
// of a meeting meant scrolling the transcript by hand to keep up, which is the
// work having a transcript beside a recording is supposed to remove.
//
// Everything needed was already here: the cues carry a clock and the player
// tracks one. What was missing was the answer to "which of these is being said
// right now".

/**
 * The cue playing at `ms`, or -1.
 *
 * The LAST cue that has started, not the nearest — a turn owns the time from
 * when it begins until the next one does, so a long pause inside somebody's
 * sentence still belongs to them rather than jumping ahead to whoever speaks
 * next.
 *
 * A binary search, because this is called on every timeupdate — four times a
 * second, against an hour of turns.
 */
export function cueAt(cues: readonly TranscriptCue[], ms: number): number {
  if (!cues?.length || !Number.isFinite(ms) || ms < 0) return -1;
  // Before the first word was spoken there is no current turn. Saying "the
  // first one" would light a line up during a silent lead-in.
  if (ms < cues[0].atMs) return -1;

  let low = 0;
  let high = cues.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].atMs <= ms) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Whether following the recording would tell a reader anything.
 *
 * `transcriptCues` clamps to zero every turn spoken before Record was pressed,
 * which is right for seeking — the nearest moment the recording holds is its
 * beginning — and useless for following: a meeting recorded from halfway has a
 * pile of turns all claiming 0ms, and marking whichever came last in the pile
 * as "now" would be inventing a fact.
 *
 * So following is offered only when the cues are timed AND the clamped pile at
 * the start is not most of them.
 */
export function cuesCanFollow(cues: readonly TranscriptCue[]): boolean {
  if (!cuesAreTimed(cues)) return false;
  const clamped = cues.filter((c) => c.atMs === 0).length;
  return clamped * 2 <= cues.length;
}
