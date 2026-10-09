// lib/meetings/transcript-finalize.ts
// The last words of a call, settled before the microphone is torn down.
//
// The speech engine hands a sentence over half a second to two seconds after
// it ends — it is still deciding what the words were. "Say the decision, press
// Leave" lands the click inside that gap, and every exit from the room used to
// tear the recognizer and the microphone down in the same tick and then keep
// only FINAL lines: the save (pendingLines) and the posted transcript both
// filter on `final`. So the sentence spoken just before the button — the one
// the meeting usually ends BECAUSE of — was still an interim, and it vanished.
// Under the ownership rule nobody else saves a participant's words, so for an
// invitee pressing Leave there was no other copy anywhere.
//
// The fix is in two halves, both here so they can be tested without a browser:
//
//   - WAIT, briefly. `recognition.stop()` makes the engine flush what it has
//     heard as a final before it ends, so the common case is settled exactly:
//     the real final replaces the interim within the wait and nothing needs
//     inventing. The wait is bounded, because an exit that can hang on a dead
//     engine is worse than a lost sentence.
//
//   - PROMOTE what never settled. An interim that outlives the wait is still
//     the engine's own transcription of speech from a live microphone — the
//     interim line only ever exists while the mic is on — and the choice at
//     the deadline is between keeping the engine's words marked uncertain and
//     keeping silence. The record keeps the words. PROMOTED_INTERIM_CONFIDENCE
//     sits below LOW_CONFIDENCE, so the line renders "(uncertain)" in the
//     record, and above MODEL_CONFIDENCE_FLOOR, so the report model still
//     reads it: the end of a meeting is usually what it decided, and a floor
//     that withheld it would lose the decision to save a marker.
//
// Nothing here writes words no engine produced: the promoted text is byte-for-
// byte what the recognizer printed from the microphone, only no longer being
// revised.

/** The part of a transcript line this module needs to decide anything. */
export interface FinalizableLine {
  text: string;
  final: boolean;
  /** Only this device's own interim exists; remote lines arrive final. */
  isLocal: boolean;
  confidence: number;
}

/**
 * How long an exit will wait for the engine to settle the sentence in flight.
 *
 * Long enough for a healthy engine's stop-flush, which arrives well under a
 * second; short enough that the person who pressed Leave is not held in a room
 * they have left. Only paid at all when something is actually mid-sentence.
 */
export const FINALIZE_WAIT_MS = 1_800;

/** How often the wait re-reads the transcript for the settled final. */
export const FINALIZE_POLL_MS = 100;

/**
 * What a promoted interim claims for itself: uncertain, but speech.
 *
 * Below LOW_CONFIDENCE (0.6) so the stored line is marked "(uncertain)" —
 * the engine never vouched for this exact wording. Above
 * MODEL_CONFIDENCE_FLOOR (0.35) so it is not withheld from the report model
 * as noise: it came from a live microphone that was, moments earlier, carrying
 * the conversation.
 */
export const PROMOTED_INTERIM_CONFIDENCE = 0.5;

/** The local sentence still being revised, or null when everything settled. */
export function trailingInterim<T extends FinalizableLine>(
  lines: readonly T[],
): T | null {
  for (const line of lines) {
    if (!line.final && line.isLocal && line.text.trim()) return line;
  }
  return null;
}

/**
 * The transcript with its unsettled tail kept as speech.
 *
 * A local interim that still carries words becomes a final at
 * PROMOTED_INTERIM_CONFIDENCE; one that is only whitespace is dropped —
 * there is nothing to keep. Finals and remote lines pass through untouched.
 */
export function promoteTrailingInterim<T extends FinalizableLine>(
  lines: readonly T[],
): T[] {
  const out: T[] = [];
  for (const line of lines) {
    if (line.final) {
      out.push(line);
    } else if (line.isLocal && line.text.trim()) {
      out.push({ ...line, final: true, confidence: PROMOTED_INTERIM_CONFIDENCE });
    }
    // A non-final line with nothing to say is formatting, not words.
  }
  return out;
}

/**
 * Settle the sentence in flight before the exit tears the microphone down.
 *
 * Resolves immediately — without touching the recognizer — when nothing is
 * mid-sentence, which is most exits. Otherwise the recognizer is stopped so
 * the engine flushes what it holds, the transcript is re-read until the
 * interim has been replaced by that final, and at the deadline whatever is
 * still unsettled is promoted rather than lost.
 *
 * The reads and writes go through callbacks because the transcript lives in a
 * ref the recognizer's own handler is writing to concurrently; this must see
 * every write, not a snapshot.
 */
export async function settleFinalWords<T extends FinalizableLine>(opts: {
  read: () => readonly T[];
  write: (lines: T[]) => void;
  stopRecognition: () => void;
  waitMs?: number;
  pollMs?: number;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<void> {
  const waitMs = opts.waitMs ?? FINALIZE_WAIT_MS;
  const pollMs = opts.pollMs ?? FINALIZE_POLL_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;

  if (!trailingInterim(opts.read())) return;

  try {
    opts.stopRecognition();
  } catch {
    /* not running — the poll below still settles or promotes */
  }

  const deadline = now() + waitMs;
  while (now() < deadline) {
    await sleep(pollMs);
    if (!trailingInterim(opts.read())) return;
  }

  const lines = opts.read();
  if (trailingInterim(lines)) opts.write(promoteTrailingInterim(lines));
}
