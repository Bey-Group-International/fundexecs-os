// lib/meetings/preview-recovery.ts
// How many times the green room goes back for a preview device that ended.
//
// A preview track that ends is reopened (see MeetingGreenRoom): a phone put
// down in the waiting room, a cable knocked, a dock re-enumerating. The common
// case ends after one reopen, and a device that is really gone ends the cycle
// by itself — the exact-id request fails, the failure path forgets the device
// and falls to the system default, then to nothing.
//
// What is left is hardware that opens and then ends on its own, over and over:
// a USB camera with a failing cable, a virtual-camera app crash-looping. Each
// cycle costs one getUserMedia, which is not a tight loop, but a guest can sit
// in a waiting room for a long time and nothing was counting. So the count is
// bounded, and a replacement that stayed up long enough to have plainly worked
// starts the count over: a device that ends once an hour is not the device
// this is for.
//
// Pure: no tracks, no timers. The green room supplies what it sees.

/** What the green room remembers about one device's reopens. */
export interface ReopenLedger {
  /** Reopens in the current run of short-lived replacements. */
  reopens: number;
  /** When the track now open was adopted, or null if none is. */
  openedAt: number | null;
}

export const FRESH_LEDGER: ReopenLedger = { reopens: 0, openedAt: null };

/**
 * How many short-lived replacements to open before stopping.
 *
 * Three is enough to ride out a device that drops once or twice while it
 * settles after being plugged in, and few enough that a device cycling every
 * few seconds is left alone within the first half minute.
 */
export const PREVIEW_REOPEN_LIMIT = 3;

/**
 * How long a replacement has to stay live for the count to start over.
 *
 * A track that lasted this long was a working device, and its ending is a
 * new event rather than the next turn of the same cycle.
 */
export const PREVIEW_STABLE_MS = 30_000;

/**
 * Whether to reopen a device whose track has just ended, and the ledger to
 * keep if so.
 *
 * `now - openedAt` is how long the track that ended had been open. Past the
 * stable period the count restarts at this reopen; within it, this reopen
 * is one more of the same run. Over the limit the answer is no, and the
 * ledger is returned unchanged so a deliberate retry (which resets it) is
 * the only way back in.
 */
export function reopenAfterEnded(ledger: ReopenLedger, now: number): { reopen: boolean; ledger: ReopenLedger } {
  const lived = ledger.openedAt !== null && now - ledger.openedAt >= PREVIEW_STABLE_MS;
  const reopens = lived ? 1 : ledger.reopens + 1;
  if (reopens > PREVIEW_REOPEN_LIMIT) return { reopen: false, ledger };
  return { reopen: true, ledger: { reopens, openedAt: null } };
}

/** A track was adopted: note when, so its lifetime can be judged if it ends. */
export function trackOpened(ledger: ReopenLedger, now: number): ReopenLedger {
  return { reopens: ledger.reopens, openedAt: now };
}
