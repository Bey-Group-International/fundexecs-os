'use client';

/**
 * lib/earn/launcher.ts — the global Ask Earn opener.
 *
 * Earn is summoned from many places (the floating orb, per-panel buttons,
 * future contextual nudges). Rather than prop-drill an open handler through
 * the tree, any client surface calls `openEarn()` and the shell — which owns
 * the panel's open state — listens for the event. Optional context lets the
 * caller hand Earn a starting intent (e.g. a command to run on open).
 */

export const EARN_OPEN_EVENT = 'fx:earn-open';

/** What a caller can hand Earn when summoning it. */
export interface EarnOpenDetail {
  /** A command id to run immediately (see the panel's COMMANDS). */
  command?: string;
  /** A free-text ask to send immediately. */
  ask?: string;
}

/** Summon the Earn panel from anywhere on the client. */
export function openEarn(detail?: EarnOpenDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<EarnOpenDetail>(EARN_OPEN_EVENT, { detail: detail ?? {} }));
}
