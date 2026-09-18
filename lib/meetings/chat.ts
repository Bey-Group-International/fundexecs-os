// lib/meetings/chat.ts
// What the in-call chat shows, and whether a message actually left the room.
//
// Chat looks like the simplest thing in the meeting and had the most ways to
// mislead the person using it. All four are here because all four are
// decisions rather than rendering:
//
//  1. A send that failed looked exactly like a send that worked. The panel
//     appended the message locally and broadcast it with the result thrown
//     away — so on a struggling socket somebody watched their own message sit
//     in a room where nobody had received it. `delivery` is what makes the
//     difference visible, and it is only ever carried on your OWN messages: a
//     message you received is delivered by definition.
//
//  2. Messages were ordered by arrival, so no two people saw the same
//     conversation. `ts` was carried through the whole feature and read by
//     nothing. Sorting on it is the same fix, for the same reason, that
//     restoreTranscript applies to transcript rows.
//
//  3. A name was whatever the message claimed. The roster already holds the
//     authoritative one, keyed by the signaling id — the same argument the
//     transcript makes for resolving a speaker's name live rather than
//     freezing it at the moment the words were spoken.
//
//  4. Text arrived unbounded and was rendered unbounded.
//
// Pure: no React, no Supabase, no clock beyond what is passed in.

/**
 * The longest message the room will send or show.
 *
 * Not a policy about how much somebody may say — it is the point past which a
 * "message" is a pasted document, and one of those costs every participant a
 * re-render and a scroll. Realtime has its own frame limit well above this;
 * this bound is about the panel.
 */
export const CHAT_MAX_LENGTH = 2000;

/**
 * How far a sender's clock may disagree with ours before we stop believing it.
 *
 * Ordering by the sender's timestamp is what makes everyone see one
 * conversation, and it hands every participant's clock a say in where their
 * messages land. Ordinary skew is milliseconds and is exactly what we want
 * applied. A machine an hour out is different in kind: every message it sends
 * would pin itself to the top or the bottom of the panel forever. Past this
 * bound we substitute our own arrival time — which is wrong by less.
 */
export const CHAT_CLOCK_TOLERANCE_MS = 2 * 60_000;

/** Whether a message you sent has actually been accepted by the socket. */
export type ChatDelivery = "sending" | "sent" | "failed";

/** One message in the panel. */
export interface ChatMessage {
  id: string;
  /** Signaling id of the sender. */
  from: string;
  displayName: string;
  text: string;
  /** Milliseconds since the epoch, as the SENDER's clock read it. */
  ts: number;
  /** Own messages only. Absent on anything received. */
  delivery?: ChatDelivery;
}

/**
 * Trim a message and bound it, on the way out and on the way in.
 *
 * Applied to received text as well as sent, because the bound that matters is
 * the one on the panel doing the rendering — a peer running an older build, or
 * a modified one, does not get to decide how much this browser draws.
 */
export function normalizeChatText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const clipped = raw.trim().slice(0, CHAT_MAX_LENGTH);
  // Never leave half a surrogate pair at the cut: a lone surrogate renders as
  // a replacement character, so clipping an emoji would end the message with
  // a black diamond rather than with the emoji missing.
  const last = clipped.charCodeAt(clipped.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? clipped.slice(0, -1) : clipped;
}

/**
 * Read a Realtime send result.
 *
 * `channel.send()` resolves to "ok", "timed out" or "error" and this feature
 * threw all three away. Anything that is not an explicit "ok" is a failure:
 * an unrecognised result means a client version we cannot interpret, and the
 * safe reading of "I do not know whether that was delivered" is to tell the
 * person it was not.
 */
export function deliveryFromSendResult(result: unknown): ChatDelivery {
  return result === "ok" ? "sent" : "failed";
}

/**
 * The timestamp to file a received message under.
 *
 * See CHAT_CLOCK_TOLERANCE_MS. A missing or unparseable claim is treated the
 * same as an impossible one.
 */
export function resolveTimestamp(
  claimed: unknown,
  receivedAt: number,
  toleranceMs: number = CHAT_CLOCK_TOLERANCE_MS,
): number {
  if (typeof claimed !== "number" || !Number.isFinite(claimed)) return receivedAt;
  return Math.abs(claimed - receivedAt) > toleranceMs ? receivedAt : claimed;
}

/** Whether `a` belongs after `b` in the panel. */
function isAfter(a: ChatMessage, b: ChatMessage): boolean {
  if (a.ts !== b.ts) return a.ts > b.ts;
  // Two messages sent in the same millisecond still need ONE order, and it has
  // to be the same order on every screen — so it is decided by the id the
  // sender minted, which every participant sees the same value of.
  return a.id > b.id;
}

/**
 * Place a message in the panel, in the order it was spoken.
 *
 * A backward scan rather than a re-sort: the list is already ordered and a new
 * message almost always belongs at the end, so the common case costs one
 * comparison. The out-of-order case — a peer whose packet took the long way
 * round — is the whole point, and it is rare enough to pay for by walking.
 *
 * Ignores a message whose id is already present. Broadcast does not redeliver,
 * so this is not the case it exists for; it exists so that a retry of a
 * message that did in fact go out cannot show it twice.
 */
export function insertMessage(
  list: readonly ChatMessage[],
  msg: ChatMessage,
): ChatMessage[] {
  if (list.some((m) => m.id === msg.id)) return [...list];
  const out = [...list];
  let i = out.length;
  while (i > 0 && isAfter(out[i - 1], msg)) i -= 1;
  out.splice(i, 0, msg);
  return out;
}

/** Record what the socket said about one of our own messages. */
export function markDelivery(
  list: readonly ChatMessage[],
  id: string,
  delivery: ChatDelivery,
): ChatMessage[] {
  return list.map((m) => (m.id === id ? { ...m, delivery } : m));
}

/**
 * The name to show against a message.
 *
 * Resolved from the roster by signaling id, and only falling back to the name
 * the message carried. The id is what every other part of the room agrees on;
 * the name in the payload is a claim by whoever sent it, which is both how a
 * modified client could sign somebody else's name to a message and why a
 * rename never used to reach the panel.
 */
export function displayNameFor(
  msg: { from: string; displayName?: string },
  roster: ReadonlyMap<string, { displayName: string }>,
): string {
  const known = roster.get(msg.from)?.displayName?.trim();
  if (known) return known;
  const claimed = (msg.displayName ?? "").trim();
  return claimed || "Someone";
}
