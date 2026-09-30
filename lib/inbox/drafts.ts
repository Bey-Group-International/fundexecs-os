// lib/inbox/drafts.ts
// Unsent reply text held against a thread, and where it belongs on the board.
//
// The meeting report writes these (see app/api/meetings/[id]/follow-up/draft) and
// the inbox composer is the only thing that can send one. Which makes the board's
// job here specific: a thread carrying a draft somebody asked for is the thing to
// act on, and it must not be possible to miss it.
//
// That is not automatic. The board reads 100 threads ordered by priority then
// recency, and a thread created to hold a follow-up has neither — priority 0 and
// no messages — so it sorts to the very bottom, or off the page entirely. Both of
// the rules here exist for that.
//
// Pure: no database, no clock, no network.

/** A draft as the board and the composer need it. */
export interface ThreadDraft {
  threadId: string;
  body: string;
  source: string;
  sourceMeetingId: string | null;
  updatedAt: string;
}

/**
 * How many drafts one board read will consider.
 *
 * Drafts are few by construction — one per thread, written deliberately — so this
 * is a guard against a pathological org rather than a page.
 */
export const DRAFT_LIMIT = 200;

/**
 * Which draft-carrying threads the main page read missed.
 *
 * Returns nothing when a filter is active, and that is the rule rather than an
 * omission: a filtered board shows what matches the filter. Pulling a draft
 * thread into a search for "acme" because it happens to hold a draft would make
 * the filter a suggestion.
 */
export function missingDraftThreadIds(input: {
  draftThreadIds: readonly string[];
  onPage: readonly string[];
  filtered: boolean;
}): string[] {
  if (input.filtered) return [];
  const present = new Set(input.onPage);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of input.draftThreadIds) {
    if (present.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Put the threads carrying a draft first, and leave everything else where it was.
 *
 * A reorder rather than a written priority. The alternative — the report stamping
 * a priority number on the thread so it sorts high — would put a fabricated
 * triage score in a column the intelligence layer owns, and every reader of that
 * column would believe it.
 *
 * Stable within each group, so the board's own ordering (priority, then recency)
 * still decides the order of the drafts among themselves and of everything under
 * them.
 */
export function draftsFirst<T>(items: readonly T[], hasDraft: (item: T) => boolean): T[] {
  const withDraft: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (hasDraft(item)) withDraft.push(item);
    else rest.push(item);
  }
  return [...withDraft, ...rest];
}

/** Where a draft came from, in the one line the composer shows above it. */
export function draftOrigin(draft: ThreadDraft): string {
  return draft.source === "meeting_follow_up"
    ? "Drafted from a meeting report. Nothing has been sent."
    : "An unsent draft is waiting on this thread.";
}

/**
 * Whether a thread action should take the thread's draft away with it.
 *
 * Narrowed to an inline reply carrying text, and the narrowing is the rule.
 * Proposing a time or confirming a booking on the same thread is a different move
 * and must not quietly discard a follow-up nobody has sent yet — a suggested
 * action fired from the card would otherwise delete the draft sitting under it.
 */
export function shouldClearDraft(action: string, replyBody: string | undefined | null): boolean {
  return action === "send_reply" && Boolean(replyBody && replyBody.trim());
}
