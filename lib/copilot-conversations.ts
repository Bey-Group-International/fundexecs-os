// lib/copilot-conversations.ts
// Conversation identity and storage for the Earn copilot dock.
//
// The dock used to keep ONE thread and ONE session id for the whole app, in a
// single browser-storage blob. Asking about a deal and then walking to Wallet
// continued the same thread — and shipped those deal turns to the model as
// prior context. Conversations are separated by *place* instead: a deal owns
// one, each hub/module owns one, and they never see each other's turns.
//
// Everything here is pure so the rules can be tested without a browser.
import { copilotContextFromPath } from "@/lib/copilot";

/** Storage schema version. A bump migrates rather than discards. */
export const CONVERSATIONS_VERSION = 2;

/** Browser-storage key holding every conversation this tab knows about. */
export const CONVERSATIONS_KEY = "earn-copilot-conversations";

/** The pre-v2 key: one thread, one session, for the entire app. */
export const LEGACY_THREAD_KEY = "earn-copilot-thread";

/**
 * How many conversations a tab keeps. Older ones fall off the end — they are
 * still on the server as sessions, so nothing is actually lost, and this keeps
 * the storage blob from growing without bound.
 */
export const MAX_STORED_CONVERSATIONS = 12;

/** One stored conversation. `thread` stays `unknown[]` so this module never
 *  has to know the dock's turn shape — it only files and prunes. */
export interface StoredConversation<T = unknown> {
  /** Stable key for the place this conversation belongs to. */
  key: string;
  /** Human label for the place, shown in the dock's conversation switcher. */
  label: string;
  /** The server session backing it, once one exists. */
  sessionId: string | null;
  thread: T[];
  /** Epoch ms of the last turn, for ordering and pruning. */
  updatedAt: number;
}

export interface ConversationStore<T = unknown> {
  version: number;
  conversations: StoredConversation<T>[];
}

/**
 * The conversation key for a location. A deal owns one conversation across all
 * of its modules (the war room and its documents tab are the same piece of
 * work); everywhere else the copilot's own scope key is the identity.
 */
export function conversationKeyForPath(pathname: string): string {
  const ctx = copilotContextFromPath(pathname);
  return ctx.dealId ? `deal:${ctx.dealId}` : `scope:${ctx.scope}`;
}

/** Turn a slug segment into a readable word ("deal_room" → "Deal room"). */
function humanize(slug: string): string {
  const words = slug.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

/**
 * A readable name for the place a conversation belongs to — what the dock's
 * switcher lists. Deals read as "Deal" until the deal's own name is known;
 * the dock passes that in when it has it.
 */
export function conversationLabelForPath(pathname: string, dealName?: string | null): string {
  const ctx = copilotContextFromPath(pathname);
  if (ctx.dealId) return dealName?.trim() ? `Deal · ${dealName.trim()}` : "Deal";
  return ctx.scope.split("/").map(humanize).join(" · ");
}

/** An empty store, used on first run and whenever stored JSON is unusable. */
export function emptyStore<T>(): ConversationStore<T> {
  return { version: CONVERSATIONS_VERSION, conversations: [] };
}

/**
 * Read a store out of whatever the browser had. Anything unrecognizable
 * degrades to empty rather than throwing — a corrupt blob must never take the
 * dock down with it.
 */
export function parseStore<T>(raw: string | null): ConversationStore<T> {
  if (!raw) return emptyStore<T>();
  try {
    const parsed = JSON.parse(raw) as Partial<ConversationStore<T>>;
    if (!parsed || !Array.isArray(parsed.conversations)) return emptyStore<T>();
    const conversations = parsed.conversations.filter(
      (c): c is StoredConversation<T> =>
        Boolean(c) && typeof c.key === "string" && Array.isArray(c.thread),
    );
    return { version: CONVERSATIONS_VERSION, conversations };
  } catch {
    return emptyStore<T>();
  }
}

/**
 * Fold a pre-v2 single-thread blob into the store, filed under the place it is
 * adopted from. The old blob had no notion of location, so it lands wherever
 * the operator is when they first load the new dock, and only if that place has
 * no conversation yet — an existing conversation is never overwritten.
 */
export function migrateLegacyThread<T>(
  store: ConversationStore<T>,
  legacyRaw: string | null,
  args: { key: string; label: string; now: number },
): ConversationStore<T> {
  if (!legacyRaw) return store;
  let legacy: { sessionId?: string | null; thread?: T[] };
  try {
    legacy = JSON.parse(legacyRaw) as { sessionId?: string | null; thread?: T[] };
  } catch {
    return store;
  }
  const thread = Array.isArray(legacy?.thread) ? legacy.thread : [];
  if (thread.length === 0) return store;
  if (store.conversations.some((c) => c.key === args.key)) return store;
  return {
    version: CONVERSATIONS_VERSION,
    conversations: [
      { key: args.key, label: args.label, sessionId: legacy.sessionId ?? null, thread, updatedAt: args.now },
      ...store.conversations,
    ],
  };
}

/** The conversation filed under a key, or undefined when there is none yet. */
export function findConversation<T>(
  store: ConversationStore<T>,
  key: string,
): StoredConversation<T> | undefined {
  return store.conversations.find((c) => c.key === key);
}

/**
 * File a conversation under its key, newest first, and drop the oldest beyond
 * the cap. A conversation with no turns is not stored at all — walking through
 * a page without asking anything should not leave a trace.
 */
export function upsertConversation<T>(
  store: ConversationStore<T>,
  conversation: StoredConversation<T>,
): ConversationStore<T> {
  const rest = store.conversations.filter((c) => c.key !== conversation.key);
  const next = conversation.thread.length > 0 ? [conversation, ...rest] : rest;
  return {
    version: CONVERSATIONS_VERSION,
    conversations: next
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_STORED_CONVERSATIONS),
  };
}

/** Drop one conversation entirely — the dock's "clear this conversation". */
export function removeConversation<T>(
  store: ConversationStore<T>,
  key: string,
): ConversationStore<T> {
  return {
    version: CONVERSATIONS_VERSION,
    conversations: store.conversations.filter((c) => c.key !== key),
  };
}

/**
 * Conversations other than the current one, newest first — what the switcher
 * offers. Empty conversations never reach here (they are not stored).
 */
export function otherConversations<T>(
  store: ConversationStore<T>,
  currentKey: string,
): StoredConversation<T>[] {
  return store.conversations
    .filter((c) => c.key !== currentKey && c.thread.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The name a dock conversation's session carries in /sessions: the place it
 * happened, then what was asked. Leading `[...]` routing annotations are
 * stripped the same way the engine strips them, so an internal prefix never
 * becomes the visible title of somebody's session.
 */
export function copilotSessionName(pathname: string, firstMessage: string): string {
  const label = conversationLabelForPath(pathname);
  const topic = firstMessage
    .replace(/^\[.*?\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!topic) return label || "Untitled session";
  const name = label ? `${label} — ${topic}` : topic;
  return name.length > 120 ? `${name.slice(0, 119).trimEnd()}…` : name;
}
