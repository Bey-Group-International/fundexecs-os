// lib/meetings/chat.ts
// The rules meeting chat needs, none of which involve a network.
//
// Chat was a broadcast and a React array: nothing stored it, so a person who
// joined ten minutes late saw an empty panel, a reload emptied your own copy,
// and the whole conversation went when the call did — including the links
// people had shared, which is the single commonest thing anyone puts in a
// meeting chat.
//
// Storing it makes three things matter that did not before. What may be sent
// has to be bounded, because it is now going into a table. History and live
// messages have to merge without duplicating, because a message you sent
// arrives back to you from the server as well. And the result has to READ like
// a conversation rather than a log, which is grouping and times and — above
// all — links you can actually follow.

/** Longest message this accepts. A chat line is a sentence, not a document. */
export const MAX_CHAT_CHARS = 2_000;
/** Consecutive messages from one person inside this window read as one turn. */
export const GROUP_WINDOW_MS = 120_000;

export interface ChatMessage {
  id: string;
  /** Who sent it, as the room knows them. */
  from: string;
  displayName: string;
  text: string;
  /** Epoch milliseconds. */
  ts: number;
}

/**
 * What a message becomes on its way out, or "" for one that should not be sent.
 *
 * Trimmed, capped, and stripped of the control characters a paste can carry —
 * which are invisible in the composer and are about to be stored, rendered to
 * everyone in the room, and put in an exported document. Interior newlines
 * survive: somebody pasting three lines of an address meant the three lines.
 */
export function cleanChatText(raw: string | null | undefined): string {
  const text = (raw ?? "")
    // Control characters except newline and tab, which are legitimate here.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    // Runs of blank lines collapse: a paste should not push the room's
    // conversation off the top of the panel.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > MAX_CHAT_CHARS ? text.slice(0, MAX_CHAT_CHARS).trimEnd() : text;
}

/**
 * History and live messages as one conversation.
 *
 * Keyed by id and ordered by time, because both halves overlap: the server
 * hands back messages this browser has already shown, and a broadcast can
 * arrive before the row it was written from is readable. Ids are minted by the
 * sender for exactly this reason.
 *
 * A later copy of an id wins. The stored row is the one with the authoritative
 * name and time, and it is the one that arrives second.
 */
export function mergeChat(...groups: ReadonlyArray<readonly ChatMessage[]>): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const group of groups) {
    for (const msg of group ?? []) {
      if (!msg?.id || typeof msg.text !== "string") continue;
      byId.set(msg.id, msg);
    }
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
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
 * people's text, and the previous version showed it as flat, unclickable
 * prose precisely because making it clickable safely was never done.
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
