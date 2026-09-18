// lib/meetings/reactions.ts
// What a reaction is, and where the room can actually see it.
//
// Reactions had the same problem raised hands had, and `hands.ts` had already
// written the argument down:
//
//   "the tile is off-screen in speaker layout or below the fold in a large grid"
//
// Hands were given a toolbar count and a spoken label. Reactions were left
// drawn in exactly one place — an overlay on the sender's tile — and they are
// the worse case of the two. A hand stays up until it is lowered, so a late
// look still finds it. A reaction lives three seconds and is then gone. And a
// screen share FORCES speaker layout, so everyone but the presenter is in a
// horizontally-scrolling strip at the moment people most want to react.
//
// The other half of this module is the bound. The picker offers six emoji;
// nothing on the receiving side ever checked that what arrived was one of
// them, and the tile draws whatever it is at text-4xl.
//
// Pure: no React, no DOM, no clock beyond what is passed in.

/**
 * What the picker offers, and — now — what a peer is allowed to send.
 *
 * An allowlist rather than a length bound, because "a reaction" means one of
 * these six and nothing else. A length bound would still let a modified client
 * write eight characters of whatever it liked across somebody's tile.
 *
 * The cost is that a tab left open across a deploy, on a build whose list has
 * since grown, sends something this build will drop. That is the right way
 * round: a reaction that does not appear is a reaction nobody notices, where an
 * unbounded one is a reaction nobody can avoid.
 */
export const REACTIONS = ["👍", "👏", "😂", "❤️", "🎉", "🤔"] as const;

export type Reaction = (typeof REACTIONS)[number];

/** How long a reaction stays up. */
export const REACTION_VISIBLE_MS = 3_000;

const ALLOWED: ReadonlySet<string> = new Set(REACTIONS);

/**
 * The reaction in a message, or "" if it is not one.
 *
 * Applied on the way IN as well as the way out, because the bound that matters
 * is the one on the client doing the rendering — the same argument
 * normalizeChatText makes about chat text. A peer running a modified build does
 * not get to decide what this browser draws across a tile.
 */
export function normalizeReaction(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  return ALLOWED.has(trimmed) ? trimmed : "";
}

/** One person's reaction, and when it arrived on THIS client's clock. */
export interface ReactionState {
  emoji: string;
  /** Local arrival time. Ordering only — never shown. */
  at: number;
}

/** A reaction with the person attached, ready to render. */
export interface ActiveReaction {
  id: string;
  displayName: string;
  emoji: string;
}

/**
 * Everyone currently reacting, oldest first.
 *
 * Ordered by arrival rather than by the record's key order, because a record
 * keeps a key in its original position when its value is replaced — so
 * somebody reacting twice would stay wherever they first appeared while
 * everyone who reacted after them moved past. Oldest first so the newest
 * arrival is at the end, where a ticker grows.
 *
 * Your own reaction is INCLUDED, unlike `raisedBy` for hands. You already know
 * your hand is up — the tile shows it and the button is lit — but a reaction is
 * a thing you fired and then have nothing to confirm, and the tile that would
 * confirm it is exactly the one that may be scrolled out of the strip.
 *
 * Somebody who has left is dropped: a reaction from a person who is no longer
 * in the room is not something anyone can make sense of.
 */
export function activeReactions(
  reactions: Readonly<Record<string, ReactionState>>,
  participants: readonly { id: string; displayName: string }[],
): ActiveReaction[] {
  const byId = new Map(participants.map((p) => [p.id, p.displayName]));
  const timed: (ActiveReaction & { at: number })[] = [];
  for (const [id, state] of Object.entries(reactions)) {
    if (!state?.emoji) continue;
    const displayName = byId.get(id);
    // Somebody who has left. Their reaction is not something anyone can place.
    if (displayName === undefined) continue;
    timed.push({ id, displayName, emoji: state.emoji, at: state.at });
  }
  // Two reactions in the same millisecond still need one order, and it has to
  // be the same one on every screen, so the id decides it.
  timed.sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id < b.id ? -1 : 1));
  return timed.map(({ id, displayName, emoji }) => ({ id, displayName, emoji }));
}

/**
 * The record with one person's reaction removed.
 *
 * Returns the SAME object when there is nothing to remove, which is the whole
 * point: the expiry timer used to allocate a fresh record unconditionally, so
 * an expiry for somebody who had already left re-rendered the entire meeting
 * for nothing. The leave handler in the room got this right; the timer beside
 * it did not, so the rule lives here now and both call it.
 */
export function withoutReaction(
  reactions: Readonly<Record<string, ReactionState>>,
  who: string,
): Readonly<Record<string, ReactionState>> {
  if (!(who in reactions)) return reactions;
  const next = { ...reactions };
  delete next[who];
  return next;
}

/**
 * How the room says a reaction out loud.
 *
 * The tile overlay is a bare emoji with no text, so a screen reader had nothing
 * to announce — reactions were entirely absent for anyone not looking at the
 * picture. This is the equivalent of handsUpLabel, which its own docstring
 * describes as being "for a tooltip and for a screen reader".
 */
export function reactionLabel(entry: ActiveReaction): string {
  const name = entry.displayName.trim() || "Someone";
  return `${name} reacted ${entry.emoji}`;
}
