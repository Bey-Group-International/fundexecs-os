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
//  5. Nothing stored it. A person who joined ten minutes late saw an empty
//     panel, a reload emptied their own copy, and the whole conversation went
//     when the call did — including the links people shared, which is the
//     commonest thing anyone puts in a meeting chat. Storing it makes two more
//     things decisions rather than rendering: history and live messages have to
//     fold together without duplicating (mergeChat), and the result has to read
//     as a conversation rather than a log — grouping, times, and links you can
//     actually follow (groupChat, chatClock, chatParts).
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
  const clean = raw
    // One newline convention, so a paste from a Windows editor does not carry
    // a stray carriage return into the table and the exported document.
    .replace(/\r\n?/g, "\n")
    // Control characters other than newline and tab: invisible in the
    // composer, and now on their way into a row, onto everyone's screen and
    // into an export. Interior newlines survive — somebody pasting three lines
    // of an address meant the three lines.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    // A paste should not push the room's conversation off the top of the panel.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const clipped = clean.slice(0, CHAT_MAX_LENGTH);
  // Never leave half a surrogate pair at the cut: a lone surrogate renders as
  // a replacement character, so clipping an emoji would end the message with
  // a black diamond rather than with the emoji missing.
  const last = clipped.charCodeAt(clipped.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? clipped.slice(0, -1) : clipped).trimEnd();
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

// ── Stored chat ─────────────────────────────────────────────────────────────
//
// Everything above is about the message on its way through the room. What
// follows is about the conversation once it is a table: folding the history
// back in without duplicating it, and rendering it as something a person reads
// rather than a log they scan.

/** Consecutive messages from one person inside this window read as one turn. */
export const GROUP_WINDOW_MS = 120_000;

/**
 * History and the live panel as one conversation.
 *
 * Keyed by id and ordered exactly as insertMessage orders, because both halves
 * overlap: the server hands back messages this browser has already shown, and
 * a broadcast can arrive before the row it was written from is readable. Ids
 * are minted by the sender for that reason.
 *
 * A later group wins, so the caller decides which copy is authoritative —
 * `mergeChat(panel, history)` lets the stored row correct the name and time.
 * `delivery` is the exception: it is carried forward from the earlier copy,
 * because it is local knowledge about your own send that no stored row has and
 * losing it would silently retract a "Not delivered" the sender is looking at.
 */
export function mergeChat(...groups: ReadonlyArray<readonly ChatMessage[]>): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const group of groups) {
    for (const msg of group ?? []) {
      if (!msg?.id || typeof msg.text !== "string") continue;
      const before = byId.get(msg.id);
      byId.set(
        msg.id,
        before?.delivery !== undefined && msg.delivery === undefined
          ? { ...msg, delivery: before.delivery }
          : msg,
      );
    }
  }
  return [...byId.values()].sort((a, b) => (isAfter(a, b) ? 1 : isAfter(b, a) ? -1 : 0));
}

export interface ChatTurn {
  /** The id of the first message, so React keys stay stable as the turn grows. */
  id: string;
  from: string;
  displayName: string;
  /** When the turn started. */
  ts: number;
  messages: ChatMessage[];
}

/**
 * Consecutive messages from one person, as one turn.
 *
 * Somebody sending three lines in a row is one person talking, not three
 * events, and repeating their name above each line is how a short exchange
 * becomes a wall. Bounded by time as well as by sender: the same person
 * returning twenty minutes later has said something new.
 */
export function groupChat(messages: readonly ChatMessage[], windowMs = GROUP_WINDOW_MS): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const msg of messages ?? []) {
    const last = turns[turns.length - 1];
    const previous = last?.messages[last.messages.length - 1];
    if (last && last.from === msg.from && previous && msg.ts - previous.ts <= windowMs) {
      last.messages.push(msg);
      continue;
    }
    turns.push({ id: msg.id, from: msg.from, displayName: msg.displayName, ts: msg.ts, messages: [msg] });
  }
  return turns;
}

export type ChatPart =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string };

// Deliberately narrow. This decides what becomes a clickable href in front of
// everyone in the room, so it matches plainly-written http(s) URLs and nothing
// else — no bare domains, no "javascript:", no scheme somebody invented.
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
/** Trailing punctuation that is almost always the sentence's, not the URL's. */
const TRAILING = /[.,;:!?)\]}'"]+$/;

/**
 * A message split into text and the links inside it.
 *
 * Parts rather than markup: the caller renders them as React nodes, so nothing
 * here can put HTML on a page. That is the whole point — this is other
 * people's text, and the panel showed a shared URL as flat, unfollowable prose
 * precisely because making it clickable safely was never done.
 */
export function chatParts(text: string): ChatPart[] {
  const out: ChatPart[] = [];
  const source = text ?? "";
  let cursor = 0;

  for (const match of source.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let url = match[0];

    // "see https://example.com/docs." — the full stop ends the sentence.
    const trimmed = url.replace(TRAILING, "");
    const dropped = url.length - trimmed.length;
    url = trimmed;

    if (!isSafeHref(url)) continue;
    if (start > cursor) out.push({ kind: "text", value: source.slice(cursor, start) });
    out.push({ kind: "link", value: url, href: url });
    cursor = start + match[0].length - dropped;
  }

  if (cursor < source.length) out.push({ kind: "text", value: source.slice(cursor) });
  return out.filter((part) => part.kind === "link" || part.value.length > 0);
}

/** Parsed, and http(s) — not merely starting with something that looks like it. */
function isSafeHref(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** The time a message is stamped with, as the panel shows it. */
export function chatClock(ts: number, locale?: string): string {
  const at = new Date(ts);
  if (isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}
