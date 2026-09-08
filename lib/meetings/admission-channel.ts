// lib/meetings/admission-channel.ts
// Where a waiting guest is told that their answer is ready.
//
// Guests are unauthenticated, and live_meeting_admissions is readable only by
// org members, so they cannot watch the table over Realtime the way the host
// does. What they can do — and already do for WebRTC signalling once admitted —
// is subscribe to a broadcast channel with the anon key. So the host's decision
// is pushed to them on one, and the poll becomes a safety net rather than the
// mechanism.
//
// Two decisions about that channel, both about not trusting it.
//
// It carries no verdict. A broadcast is a nudge — "your answer changed, go and
// ask" — and the guest then reads the decision from the server exactly as it
// always has. Anyone holding the room code can publish on a channel like this,
// so a payload saying "admitted" would be an invitation to forge one. A nudge
// that is forged costs the forger one wasted request by an honest guest, and
// nothing else. (Note that entry to the room has never been enforced by the
// waiting room alone: the signalling channel is reachable by anyone with the
// room code. This keeps that property exactly as it was rather than adding to
// it.)
//
// And it is per guest, not per meeting. A shared channel would have to name
// whose decision changed, which tells everyone listening another guest's key —
// and a key is enough to read that guest's status from the poll endpoint. A
// channel only somebody who already knows the key can find leaks nothing.

/** The broadcast event. One name, so publisher and subscriber cannot drift. */
export const ADMISSION_NUDGE = "admission";

/**
 * The channel a given guest listens on for their own decision.
 *
 * Keyed by room code rather than meeting id because the guest always has the
 * room code — it is what they were given — and the server can resolve it.
 */
export function admissionChannelName(roomCode: string, guestKey: string): string {
  return `admission:${roomCode}:${guestKey}`;
}
