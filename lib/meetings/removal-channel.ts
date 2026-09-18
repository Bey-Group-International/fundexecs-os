// lib/meetings/removal-channel.ts
// Telling a room that somebody has been removed from it.
//
// The same shape, and for the same reason, as admission-channel.ts: the
// broadcast carries NO verdict. Anyone holding the room code can publish on a
// channel like this — that is already true of the signalling channel the call
// runs on — so a payload saying "drop peer X" would be an invitation to forge
// one, and forging one would eject anybody from any meeting whose code you have.
//
// So this is a nudge. It says "the removals for this room changed, go and ask",
// and each client then asks the server about the peers IT can see, naming them
// itself. A forged nudge costs an honest client one wasted request and nothing
// else.
//
// One channel per room rather than per person, unlike the admission nudge. The
// reason that one is per guest is that naming whose decision changed would leak
// a guest key, which is enough to read that guest's status. This nudge names
// nobody at all, so there is nothing to leak and everyone in the room needs it.

/** The broadcast event. One name, so publisher and subscriber cannot drift. */
export const REMOVAL_NUDGE = "removal";

/**
 * The channel a room's participants listen on for removals.
 *
 * Keyed by room code, which every participant has — it is what they joined
 * with — and which the server can resolve without a lookup.
 */
export function removalChannelName(roomCode: string): string {
  return `removals:${roomCode}`;
}
