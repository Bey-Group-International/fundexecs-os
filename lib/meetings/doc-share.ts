// lib/meetings/doc-share.ts
// Putting a data-room document in front of the person you are talking to,
// without leaving the call.
//
// The firm's materials already have a sharing surface: a `data_room_shares`
// row mints a token, and `/dataroom/<token>` serves the document behind
// whatever gates the link was given. What it did not have was a path that
// survives a conversation. Mid-call, the host's options were:
//
//   leave the call -> Build -> Materials -> pick a room -> Share -> set the
//   gates -> copy the link -> come back -> paste it into chat
//
// or screen-share the document, which hands over nothing: no artifact the LP
// still has tomorrow, no record that it was shown, no revoke.
//
// So this module is the rules for the first path, collapsed to one tap. The
// delivery is deliberately NOT new plumbing: the link is announced in the
// meeting chat, which is already stored, already ordered by the server's
// clock, already deduped on the sender's id, already linkified, and already in
// the report and the export. A guest with no account reads it there, which is
// the whole point — the person on the other end of the call usually has no
// login at all.
//
// Pure: no React, no Supabase, no clock beyond what is passed in.
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { sectionLabel } from "@/lib/data-rooms";

/**
 * How long a link minted during a call stays alive.
 *
 * A call-time share has a different life from one the firm composes
 * deliberately in the Share panel. It is handed over in conversation, it is
 * usually read in the hours or days afterwards, and nobody is going to come
 * back and revoke it. Two weeks is long enough that "I'll look at it this
 * weekend" works and short enough that a link handed out in a call last
 * quarter is not still live.
 *
 * It is a DEFAULT, not a ceiling: the share row carries a real `expires_at`,
 * so the Shares list can extend or revoke it like any other. What matters is
 * that the unattended path is not "forever", which is what you get from a
 * picker whose expiry field is left blank.
 */
export const DOC_SHARE_EXPIRY_DAYS = 14;

/**
 * Most documents the picker will ever be handed.
 *
 * A firm with eight rooms of eighty documents is not unusual, and this list is
 * rendered inside a live call — the one place in the product where a long
 * render competes with video decoding for the same frame budget. The bound is
 * on the load, not on the firm: past it the picker says so rather than
 * silently showing a prefix, because a host who cannot find a document needs
 * to know whether it is missing or merely not in the first page.
 */
export const DOC_SHARE_MAX_LIST = 300;

/** Why a published document cannot be handed over from the call. */
export type DocShareBlock =
  /** `draft` or `review`: not signed off, so the data room itself hides it. */
  | "not-ready"
  /** No file and no inline content — the link would open on a blank page. */
  | "empty";

/** A document as the in-call picker sees it. */
export interface MeetingDoc {
  id: string;
  name: string;
  /** Data-room section key. */
  section: string;
  /** That key's display label, resolved once here rather than per render. */
  sectionLabel: string;
  /** The room the share will be attributed to. See `shareableDocuments`. */
  roomId: string;
  roomName: string;
  /** Null when it can be shared; otherwise why not. */
  blocked: DocShareBlock | null;
}

export interface DocShareRoom {
  id: string;
  name: string;
  isDefault: boolean;
}

/** One row of a room's publish manifest. */
export interface DocShareEntry {
  roomId: string;
  documentId: string;
  sortOrder: number;
}

/** The document itself, as much of it as the decision needs. */
export interface DocShareDocument {
  id: string;
  name: string;
  /** The document's `doc_type`; null files under the catch-all section. */
  section: string | null;
  /** `draft` | `review` | `ready`. Anything else is treated as not ready. */
  status: string | null;
  /** Whether an uploaded file backs it. */
  hasFile: boolean;
  /** Whether inline content backs it. */
  hasContent: boolean;
}

/**
 * What the picker offers, in the order it offers it.
 *
 * Three decisions live here, and all three are the kind that go wrong quietly:
 *
 *  1. **A document is offered once, not once per room.** A deck published into
 *     four rooms was four rows in the picker, and picking the wrong one
 *     attributed the share to a room the host was not thinking about. The
 *     survivor is the one from the DEFAULT room, else the earliest-created
 *     room that carries it — a stable rule, so the same document attributes
 *     the same way in every call.
 *
 *  2. **Not-ready documents are shown, blocked, rather than hidden.** Hiding
 *     them is what produces "where is my document" halfway through a call with
 *     an LP, with no way to tell a draft from one that was never published.
 *     `documents.status` gates the data room already; this surfaces the same
 *     gate with its reason attached.
 *
 *  3. **A document with neither a file nor inline content is blocked too.**
 *     "Easy to share" must not mean easy to hand somebody a blank page, and a
 *     row in the manifest is no promise that anything is behind it.
 *
 * Ordering is the room's own: section as the data room lists sections, then
 * the manifest's `sort_order`, then name — so the picker reads like the room
 * the host already knows, not like a database.
 */
export function shareableDocuments(input: {
  rooms: readonly DocShareRoom[];
  entries: readonly DocShareEntry[];
  documents: readonly DocShareDocument[];
}): MeetingDoc[] {
  const roomById = new Map(input.rooms.map((r) => [r.id, r]));
  // Default first, then creation order as the caller supplied it. This is the
  // tie-break for decision 1 above, so it has to be a total order and not
  // merely "whichever row came back first".
  const roomRank = new Map<string, number>();
  input.rooms.forEach((r, i) => roomRank.set(r.id, r.isDefault ? -1 : i));

  const docById = new Map(input.documents.map((d) => [d.id, d]));

  // One entry per document: the best-ranked room that publishes it.
  const chosen = new Map<string, DocShareEntry>();
  for (const entry of input.entries) {
    if (!roomById.has(entry.roomId)) continue;
    if (!docById.has(entry.documentId)) continue;
    const held = chosen.get(entry.documentId);
    if (!held) {
      chosen.set(entry.documentId, entry);
      continue;
    }
    const a = roomRank.get(entry.roomId) ?? Number.MAX_SAFE_INTEGER;
    const b = roomRank.get(held.roomId) ?? Number.MAX_SAFE_INTEGER;
    if (a < b) chosen.set(entry.documentId, entry);
  }

  const out: MeetingDoc[] = [];
  for (const entry of chosen.values()) {
    const doc = docById.get(entry.documentId);
    const room = roomById.get(entry.roomId);
    if (!doc || !room) continue;
    const section = doc.section ?? "other";
    out.push({
      id: doc.id,
      name: doc.name,
      section,
      sectionLabel: sectionLabel(section),
      roomId: room.id,
      roomName: room.name,
      blocked: blockReason(doc),
    });
  }

  return out.sort(compareMeetingDocs(input.entries));
}

function blockReason(doc: DocShareDocument): DocShareBlock | null {
  if ((doc.status ?? "ready") !== "ready") return "not-ready";
  if (!doc.hasFile && !doc.hasContent) return "empty";
  return null;
}

/**
 * Section, then the manifest's order, then name.
 *
 * `sectionLabel` is deliberately not the sort key: it is a display string, so
 * ordering by it would file "Fund Terms" before "Investment Strategy" and
 * reshuffle the whole picker the day a label is reworded. The section key's
 * position in the canonical list is the stable thing, and `sectionRank` reads
 * it from there.
 */
function compareMeetingDocs(entries: readonly DocShareEntry[]) {
  const orderOf = new Map(entries.map((e) => [e.documentId, e.sortOrder]));
  return (a: MeetingDoc, b: MeetingDoc): number => {
    const bySection = sectionRank(a.section) - sectionRank(b.section);
    if (bySection !== 0) return bySection;
    const byOrder = (orderOf.get(a.id) ?? 0) - (orderOf.get(b.id) ?? 0);
    if (byOrder !== 0) return byOrder;
    return a.name.localeCompare(b.name);
  };
}

/**
 * Where a section key sits in the data room's own list.
 *
 * Read off `DATA_ROOM_SECTIONS` rather than restated here. A second copy of
 * that order is a copy that drifts: the day a section is added or moved, the
 * data room and the in-call picker would disagree about where it belongs, and
 * the host would be looking for a document in the place the room puts it.
 * An unrecognised key sorts last, alongside the catch-all it renders as.
 */
const SECTION_RANK = new Map(DATA_ROOM_SECTIONS.map((s, i) => [s.key, i]));
function sectionRank(key: string): number {
  return SECTION_RANK.get(key) ?? DATA_ROOM_SECTIONS.length;
}

/**
 * Narrow the picker to what the host is typing.
 *
 * Matches the document's name AND its section label AND its room name, because
 * all three are things a host reaches for under time pressure — "the ILPA one",
 * "financials", "the Atlas room". Case- and accent-insensitive, and every term
 * has to match something, so "atlas ddq" finds the DDQ in the Atlas room
 * rather than everything in either.
 */
export function searchMeetingDocs(docs: readonly MeetingDoc[], query: string): MeetingDoc[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...docs];
  return docs.filter((doc) => {
    const haystack = fold(`${doc.name} ${doc.sectionLabel} ${doc.roomName}`);
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * Casefold and strip accents so "Fonciere" matches "Foncière".
 *
 * NFD then stripping combining marks, which is the same normalisation the
 * transcript search uses — a host should not have to reproduce a diacritic to
 * find a document they can see on screen.
 */
function fold(value: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** The picker's sections, in order, with only the documents that survived a search. */
export function groupMeetingDocs(docs: readonly MeetingDoc[]): { key: string; label: string; docs: MeetingDoc[] }[] {
  const bySection = new Map<string, MeetingDoc[]>();
  for (const doc of docs) {
    const held = bySection.get(doc.section);
    if (held) held.push(doc);
    else bySection.set(doc.section, [doc]);
  }
  return [...bySection.entries()]
    .sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]))
    .map(([key, items]) => ({ key, label: sectionLabel(key), docs: items }));
}

/**
 * What the share row is labelled, so the Shares list can explain itself later.
 *
 * The Shares list is where a firm answers "who has a live link to this?", and
 * an unlabelled row minted from a call is unanswerable — it was created by
 * somebody, during something, for someone, and the row said none of it. The
 * meeting's title is the one piece of context that identifies the occasion to
 * a human reading the list a month later.
 *
 * Bounded, because `label` is free text that reaches an email subject and the
 * audit CSV, and a meeting title is whatever the host typed.
 */
export function docShareLabel(meetingTitle: string | null | undefined): string {
  const title = (meetingTitle ?? "").trim().replace(/\s+/g, " ");
  if (!title) return "Shared in a meeting";
  return `Shared in: ${title}`.slice(0, 120);
}

/** The expiry stamped on a link minted during a call. */
export function docShareExpiresAt(now: number, days: number = DOC_SHARE_EXPIRY_DAYS): string {
  return new Date(now + days * 86_400_000).toISOString();
}

/**
 * The chat message that announces a document.
 *
 * Deliberately plain text with the bare URL in it, rather than a message kind
 * of its own. Everything downstream of the chat — `chatParts`' linkifier, the
 * stored row, the report, the export, and a guest's panel on a build from last
 * month — handles this already. A new message type would have had to be taught
 * to every one of them, and the ones it was not taught would have rendered the
 * most important message in the call as an empty bubble.
 *
 * The document's name is normalised to one line so a name carrying a newline
 * cannot push the URL out of the visible part of the bubble.
 */
export function docShareChatText(input: { documentName: string; url: string }): string {
  const name = (input.documentName ?? "").replace(/\s+/g, " ").trim() || "Document";
  return `📄 ${name} — ${input.url}`;
}

/**
 * Whether a document is already on the call's table.
 *
 * The share is keyed on (meeting, document) in the database, so a second tap
 * returns the first link rather than minting a rival one with its own expiry
 * and its own audit trail. This is the client-side half of that: the picker
 * shows "Shared" and re-announces the same URL instead of asking the server
 * again.
 */
export function sharedUrlFor(
  shared: readonly { documentId: string; url: string }[],
  documentId: string,
): string | null {
  return shared.find((s) => s.documentId === documentId)?.url ?? null;
}

/** What the picker says about a document it will not share. */
export function blockedLabel(block: DocShareBlock): string {
  return block === "not-ready"
    ? "Not published — still draft or in review"
    : "Nothing attached yet";
}
