// lib/meetings/clock-skew.ts
// Putting a transcript line on the server's clock when the speaker's is wrong.
//
// A transcript line is stamped by the browser that heard it, and the report
// orders the whole meeting by that stamp. One guest whose system clock is an
// hour out therefore does not just carry a wrong time: every line they spoke
// sorts an hour away from the conversation it was part of, so the record reads
// as one person's whole meeting followed by the other's. That happened — a
// guest on a laptop an hour behind, a host on time, and a stored transcript in
// which the guest said everything first.
//
// Nothing in the line can say which clock is right, but the request can: the
// client sends what its clock reads at the moment of sending, the server knows
// what its own reads on arrival, and the difference is the skew. Network delay
// and an old line being retried do not disturb it, because it is measured on
// the request and not on the line.
//
// Pure: no DOM, no server imports. "Now" is always passed in.

/**
 * Differences smaller than this are the network and ordinary drift, and are
 * left alone: correcting a clock that is a few seconds out would only move
 * lines around for no reason.
 */
export const SKEW_TOLERANCE_MS = 60_000;

/**
 * Differences larger than this are not a clock that is a timezone or a few
 * hours out, they are a value nobody should believe, and the lines keep the
 * stamps they arrived with.
 */
export const SKEW_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How far the sender's clock is behind the server's, in milliseconds
 * (negative when it is ahead). Zero when it cannot be known or is small enough
 * to be ignored — an old client sends nothing, and a malformed value is not a
 * reason to fail a save.
 */
export function clockSkewMs(clientNow: unknown, serverNow: number): number {
  if (typeof clientNow !== "number" || !Number.isFinite(clientNow)) return 0;
  const skew = serverNow - clientNow;
  if (Math.abs(skew) < SKEW_TOLERANCE_MS || Math.abs(skew) > SKEW_LIMIT_MS) return 0;
  return skew;
}

/**
 * A line's stamp on the server's clock. Never later than `serverNow`: a line
 * cannot have been spoken in the future, and one that appears to have been is
 * either skew that was too small to correct or a clock that is simply wrong.
 */
export function correctedTs(ts: number, skewMs: number, serverNow: number): number {
  return Math.min(ts + skewMs, serverNow);
}
