// lib/meetings/removal.ts
// Who was removed from a meeting, in a form both ends can compare.
//
// Removal has to work on two different kinds of person and the difference is
// not cosmetic. A signed-in teammate is known by their account, which they
// cannot discard and which the knock route waves straight through on
// membership — so a removal that does not key on the account does nothing at
// all to them. An invite-link guest has no account, only the `guest_key` their
// browser minted and stored; keying on that is the strongest thing available
// and it is honestly weaker, because clearing site data mints a new one.
//
// So a removal names a SUBJECT, which is one or the other, and everything else
// here is about comparing subjects without the two kinds ever being mistaken
// for each other — a guest whose key happens to read like a uuid must never
// match a member's account, and a missing value must never match a missing
// value.
//
// Pure: no network, no database, no clock beyond what is passed in.

/** A member, by account; or a guest, by the key their browser holds. */
export type RemovalSubject =
  | { kind: "member"; userId: string }
  | { kind: "guest"; guestKey: string };

/**
 * The subject for a caller, preferring the account.
 *
 * A signed-in teammate always carries both — every entrant knocks, so they have
 * a guest key too — and the account is the one worth recording: it is the one
 * they cannot throw away, and the one the knock route's membership check reads.
 * Returns null when there is neither, which is not a person this can act on.
 */
export function subjectFor(
  userId: string | null | undefined,
  guestKey: string | null | undefined,
): RemovalSubject | null {
  const id = (userId ?? "").trim();
  if (id) return { kind: "member", userId: id };
  const key = (guestKey ?? "").trim();
  return key ? { kind: "guest", guestKey: key } : null;
}

/**
 * A subject as one comparable string.
 *
 * Prefixed by kind, so the two spaces cannot collide however a guest key was
 * generated. That matters more than it looks: guest keys are `crypto.randomUUID()`
 * today, which is exactly the shape of an account id.
 */
export function subjectKey(subject: RemovalSubject): string {
  return subject.kind === "member" ? `member:${subject.userId}` : `guest:${subject.guestKey}`;
}

/** The same person, by the identifier that was recorded for them. */
export function sameSubject(a: RemovalSubject | null, b: RemovalSubject | null): boolean {
  if (!a || !b) return false;
  return subjectKey(a) === subjectKey(b);
}

/** A stored removal, in the two columns the table keeps it in. */
export interface RemovalRow {
  user_id?: string | null;
  guest_key?: string | null;
}

/** The subject a stored row names, or null for a row that names neither. */
export function subjectOfRow(row: RemovalRow | null | undefined): RemovalSubject | null {
  if (!row) return null;
  return subjectFor(row.user_id, row.guest_key);
}

/**
 * Whether this person has been removed from this meeting.
 *
 * Takes the rows rather than querying, so the same decision is made the same
 * way in the knock route, in the room, and in a test.
 */
export function isRemoved(
  removals: readonly RemovalRow[] | null | undefined,
  subject: RemovalSubject | null,
): boolean {
  if (!subject || !removals?.length) return false;
  const wanted = subjectKey(subject);
  return removals.some((row) => {
    const rowSubject = subjectOfRow(row);
    return rowSubject !== null && subjectKey(rowSubject) === wanted;
  });
}

/**
 * The subjects in `wanted` that appear in `removals`.
 *
 * The shape the room asks its question in: a client holds the subjects its
 * peers announced and wants to know which of them it should be tearing down.
 * Answering only about subjects the caller already named is the point — it
 * cannot be used to enumerate a meeting's guest keys, which would be enough to
 * read another guest's admission status.
 */
export function removedAmong(
  removals: readonly RemovalRow[] | null | undefined,
  wanted: readonly RemovalSubject[],
): RemovalSubject[] {
  if (!removals?.length) return [];
  const removed = new Set(
    removals
      .map((row) => subjectOfRow(row))
      .filter((s): s is RemovalSubject => s !== null)
      .map(subjectKey),
  );
  return wanted.filter((subject) => removed.has(subjectKey(subject)));
}

/**
 * A subject off the wire, or null.
 *
 * Every field is checked rather than trusted, because this parses what a peer
 * announced about itself and what a request body claims. Note what this does
 * NOT attempt: a client can announce any subject it likes, exactly as it can
 * already announce any display name. That is the room's existing trust model
 * and this does not pretend to change it — what it buys is that a host's
 * removal has something durable to be written against, which is checked by the
 * server against the CALLER'S OWN authenticated account when they come back.
 */
export function parseSubject(value: unknown): RemovalSubject | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { kind?: unknown; userId?: unknown; guestKey?: unknown };
  if (raw.kind === "member" && typeof raw.userId === "string") {
    return subjectFor(raw.userId, null);
  }
  if (raw.kind === "guest" && typeof raw.guestKey === "string") {
    return subjectFor(null, raw.guestKey);
  }
  return null;
}

/** The columns to write for a subject, so the two callers cannot disagree. */
export function subjectColumns(subject: RemovalSubject): { user_id: string | null; guest_key: string | null } {
  return subject.kind === "member"
    ? { user_id: subject.userId, guest_key: null }
    : { user_id: null, guest_key: subject.guestKey };
}
