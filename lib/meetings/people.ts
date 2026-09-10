// lib/meetings/people.ts
// Turning "who is coming" from something you type into something you pick.
//
// Attendees used to be free text in two boxes. A bare name carried no address,
// so the invitation could only be sent if the server could later match that
// name against the member directory — exactly, and uniquely. Two colleagues
// called Jane Doe resolved to neither (see directory.ts: emailing the wrong
// person is worse than emailing nobody), and the host learned that only after
// saving, from a line of text under a meeting that had already gone out.
//
// Picking a person instead of describing one moves that resolution to the
// moment of entry, where the ambiguity is cheap: two Jane Does are two rows
// with two different addresses, and you choose. Everything here is pure — the
// queries live in people.server.ts.

/** Where a suggestion came from. Drives grouping and the tie-break in ranking. */
export type PeopleSource = "member" | "contact" | "past";

export interface PersonSuggestion {
  /** Lower-cased address. The identity of a suggestion — dedupe key and React key. */
  email: string;
  name: string;
  /** Job title (members/contacts) or company, shown as the second line. */
  subtitle?: string;
  avatarUrl?: string;
  source: PeopleSource;
}

/** An attendee once chosen. Mirrors the stored `live_meetings.attendees` shape. */
export interface SelectedAttendee {
  name: string;
  email: string;
  type: "internal" | "external";
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim().toLowerCase());
}

/** Comparison form for names: case-folded, punctuation-light, single-spaced. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,_'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Initials for the avatar disc.
 *
 * Falls back to the address when there is no name, because "?" tells you
 * nothing about which of four unnamed guests you are looking at. Takes the
 * first and last word so "Mary-Jane van der Berg" reads MB, not MV.
 */
export function initialsFor(person: { name?: string | null; email: string }): string {
  const name = (person.name ?? "").trim();
  if (name && !isEmail(name)) {
    const words = fold(name).split(" ").filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    if (words.length > 1) {
      return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }
  }
  const local = person.email.split("@")[0] ?? "";
  return (local.slice(0, 2) || "?").toUpperCase();
}

/**
 * The palette the initials discs draw from.
 *
 * Deliberately NOT the section's status tones: a disc colour means "this is a
 * different person", never "this person is in a warning state". These are
 * mid-dark hues chosen to carry white text on a light page (all ≥ 4.5:1), and
 * they are the one place in Meetings that introduces colour outside the design
 * tokens — identity colour is its own axis, so it gets its own scale.
 */
export const AVATAR_COLORS = [
  "#1D4ED8", // blue
  "#7C3AED", // violet
  "#BE185D", // pink
  "#B91C1C", // red
  "#A45C07", // amber
  "#12784A", // green
  "#0F766E", // teal
  "#4338CA", // indigo
] as const;

/**
 * Pick a disc colour for an address.
 *
 * Deterministic, so the same person is the same colour on every render, in
 * every list, for every viewer — that stability is the entire reason the colour
 * is worth anything. FNV-1a over the address: cheap, and spreads adjacent
 * addresses (a1@, a2@) across different buckets the way summing char codes
 * would not.
 */
export function avatarColorFor(email: string): string {
  let hash = 0x811c9dc5;
  const key = email.trim().toLowerCase();
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Members are teammates; everyone else is a guest. */
export function attendeeTypeFor(source: PeopleSource): "internal" | "external" {
  return source === "member" ? "internal" : "external";
}

export function toAttendee(person: PersonSuggestion): SelectedAttendee {
  return {
    name: person.name || person.email,
    email: person.email.trim().toLowerCase(),
    type: attendeeTypeFor(person.source),
  };
}

/**
 * Does this suggestion answer to what was typed?
 *
 * Prefix-matching on each word, so "jo do" finds "John Doe" while "oh" finds
 * nobody. The address is split on its punctuation and each piece is a prefix
 * target too — people search by the local part ("jane") as readily as by the
 * domain ("fund"), and both are words to them even though the address is one
 * string.
 *
 * Matching the address as a bare substring instead is the obvious shortcut and
 * it quietly undoes the rest: nearly every address is derived from a name, so
 * `jane.doe@fund.test` contains "ane", "oe" and "und", and the careful prefix
 * rule on names buys nothing. Prefix everywhere, or prefix nowhere.
 *
 * The exception is a query carrying "@" or "." — that is address-shaped, so it
 * is somebody typing or pasting an actual address or domain rather than a name,
 * and it is matched against the whole string. Nothing else could serve it:
 * punctuation is exactly what the word split throws away.
 */
export function matchesQuery(person: PersonSuggestion, query: string): boolean {
  const raw = query.trim().toLowerCase();
  if (!raw) return true;
  const email = person.email.toLowerCase();

  if (raw.includes("@") || raw.includes(".")) {
    return email.includes(raw) || fold(person.name).includes(fold(raw));
  }

  const words = [
    ...fold(`${person.name} ${person.subtitle ?? ""}`).split(" "),
    ...email.split(/[^a-z0-9]+/),
  ].filter(Boolean);

  return fold(raw)
    .split(" ")
    .filter(Boolean)
    .every((term) => words.some((word) => word.startsWith(term)));
}

/** Rank order between sources: teammates first, then saved contacts, then history. */
const SOURCE_RANK: Record<PeopleSource, number> = { member: 0, contact: 1, past: 2 };

/**
 * Merge the three directories into one ordered list of suggestions.
 *
 * Deduped by address, keeping the best-ranked copy of a person — someone who is
 * both a teammate and a past attendee is one row, the teammate one, because
 * that copy carries the avatar and the current job title. Already-chosen
 * addresses drop out entirely: offering a guest you have already added is an
 * option that does nothing.
 *
 * Within a source, a name that starts with the query outranks one that merely
 * contains it, so typing "ja" puts Jane above Rajan.
 */
export function rankSuggestions(
  people: PersonSuggestion[],
  query: string,
  selectedEmails: Iterable<string> = [],
  limit = 8,
): PersonSuggestion[] {
  const taken = new Set([...selectedEmails].map((e) => e.trim().toLowerCase()));
  const best = new Map<string, PersonSuggestion>();

  for (const person of people) {
    const email = person.email?.trim().toLowerCase();
    if (!email || taken.has(email)) continue;
    if (!matchesQuery(person, query)) continue;
    const existing = best.get(email);
    if (!existing || SOURCE_RANK[person.source] < SOURCE_RANK[existing.source]) {
      best.set(email, { ...person, email });
    }
  }

  const q = fold(query);
  const startsWith = (p: PersonSuggestion) =>
    q && (fold(p.name).startsWith(q) || p.email.toLowerCase().startsWith(q)) ? 0 : 1;

  return [...best.values()]
    .sort(
      (a, b) =>
        SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
        startsWith(a) - startsWith(b) ||
        fold(a.name).localeCompare(fold(b.name)),
    )
    .slice(0, limit);
}

/**
 * The "invite this address" row, or null.
 *
 * A guest from outside every directory is normal and must stay addable — but
 * only as an address. A bare unmatched name cannot become an attendee, because
 * an attendee with no address is one nobody invites, and the old boxes accepted
 * exactly that and said nothing until after the meeting was saved.
 */
export function inviteRowFor(
  query: string,
  selectedEmails: Iterable<string> = [],
): PersonSuggestion | null {
  const value = query.trim().toLowerCase();
  if (!isEmail(value)) return null;
  const taken = new Set([...selectedEmails].map((e) => e.trim().toLowerCase()));
  if (taken.has(value)) return null;
  return { email: value, name: value, source: "contact" };
}
