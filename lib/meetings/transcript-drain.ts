// lib/meetings/transcript-drain.ts
// Saving everything a participant still owes, at the moment they leave.
//
// The ordinary flush runs on a timer and sends one batch; the next tick takes
// the rest. The LAST flush of a meeting has no next tick, and it is the one
// that matters most: the closing decision is the sentence the report exists
// for, and under the ownership rule (transcript-buffer.ts) the person who said
// it holds the only copy.
//
// Two things were wrong with how that last flush ran, and both lost words:
//
//   - It stopped on the first failed request. A single timed-out POST on the
//     way out abandoned every remaining line and navigated away; nothing ever
//     retried, because the page was gone.
//   - It ran only on the host's End and on a deliberate Leave. The handler that
//     runs when the HOST ends the meeting — the exit most non-hosts take —
//     tore the call down at once: no settling of the sentence still in the
//     recognizer, no drain, one unchecked keepalive batch of fifty lines.
//
// So the drain retries, briefly and boundedly, and the host waits a moment
// after saying "end" so the people it was said to have time to drain before
// the report reads the record. Pure: the room supplies the flush and the clock.

/** Rounds of batches a drain may send. Far more than any meeting needs. */
export const DRAIN_MAX_ROUNDS = 20;

/**
 * How many consecutive failures a drain rides out before giving up.
 *
 * The exit is already under way and somebody is waiting on it — a member for
 * the thank-you screen, a host for the report — so this is short. Three
 * attempts spanning a few seconds covers a request that timed out once or a
 * connection mid-roam; a server that refuses three times in a row is not
 * going to accept a fourth.
 */
export const DRAIN_RETRIES = 3;

/**
 * The pause before the next attempt after `failures` consecutive failures.
 *
 * Front-loaded: the first retry is almost immediate, because the commonest
 * failure is a request that collided with the teardown rather than a server
 * that is down.
 */
export function drainRetryDelay(failures: number): number {
  if (!Number.isFinite(failures) || failures <= 1) return 500;
  if (failures === 2) return 1_500;
  return 3_000;
}

/**
 * How long the host waits, after telling the room the meeting has ended,
 * before asking for the report.
 *
 * Everyone else drains on receipt of `end`: settling their last sentence
 * (up to FINALIZE_WAIT_MS) and sending what they owe. The report route reads
 * the stored rows once, so rows that land after it has read are not in the
 * report. This is bounded and short — a host should not sit on "Ending…" for
 * long — and the merge in transcript-restore.ts recovers late tail lines the
 * host had received over signaling. What it cannot recover is a sentence a
 * peer only settled on `end`, which is what this wait is for.
 */
export const PEER_DRAIN_GRACE_MS = 2_500;

export interface DrainOptions {
  /** How many lines are still unsaved. */
  pending: () => number;
  /** Send one batch; resolve true when the server accepted it. Never throws. */
  flush: () => Promise<boolean>;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Flush until nothing is owed, retrying briefly across failures.
 *
 * Resolves true when nothing is pending any more, false when the retries
 * were spent with lines still unsaved. A failure resets nothing: the count
 * is of CONSECUTIVE failures, so a batch that succeeds after one timeout
 * earns the next batch a fresh budget.
 */
export async function drainTranscript(opts: DrainOptions): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let failures = 0;
  for (let round = 0; round < DRAIN_MAX_ROUNDS; round++) {
    if (opts.pending() === 0) return true;
    if (await opts.flush()) {
      failures = 0;
      continue;
    }
    failures += 1;
    if (failures >= DRAIN_RETRIES) return false;
    await sleep(drainRetryDelay(failures));
  }
  return opts.pending() === 0;
}
