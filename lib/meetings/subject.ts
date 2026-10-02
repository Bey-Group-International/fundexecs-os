// lib/meetings/subject.ts
// Who a person in a meeting is, when half of them have no account.
//
// Every feature that has to name a participant runs into the same split, and
// the split is not cosmetic. A signed-in teammate is known by their account,
// which they cannot discard and which the knock route waves straight through on
// membership. An invite-link guest has no account at all, only the `guest_key`
// their browser minted and stored -- the strongest thing available for them, and
// honestly weaker, because clearing site data mints a new one.
//
// This started life inside `removal.ts`, which needed it first. Attendance needs
// exactly the same thing: `live_meeting_participants` has a nullable `user_id`
// for the same reason `live_meeting_removals` does, and a guest's row has to be
// found again on a rejoin without being mistaken for anybody else's. Rather than
// write a second copy of "which kind of person is this", the primitives moved
// here and `removal.ts` re-exports them.
//
// That is not tidiness. Two copies of this rule drifting apart is how a guest
// ends up recorded as present but impossible to remove, or removable but never
// recorded -- and the file that used to hold these said so itself, about a
// different pair of callers.
//
// Pure: no network, no database, no clock.

/** A member, by account; or a guest, by the key their browser holds. */
export type MeetingSubject =
  | { kind: "member"; userId: string }
  | { kind: "guest"; guestKey: string };

/**
 * The subject for a caller, preferring the account.
 *
 * A signed-in teammate always carries both -- every entrant knocks, so they have
 * a guest key too -- and the account is the one worth recording: it is the one
 * they cannot throw away, and the one the knock route's membership check reads.
 * Returns null when there is neither, which is not a person this can act on.
 */
export function subjectFor(
  userId: string | null | undefined,
  guestKey: string | null | undefined,
): MeetingSubject | null {
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
export function subjectKey(subject: MeetingSubject): string {
  return subject.kind === "member" ? `member:${subject.userId}` : `guest:${subject.guestKey}`;
}

/** A stored row that names a subject, in the two columns the tables keep it in. */
export interface SubjectRow {
  user_id?: string | null;
  guest_key?: string | null;
}

/** The subject a stored row names, or null for a row that names neither. */
export function subjectOfRow(row: SubjectRow | null | undefined): MeetingSubject | null {
  if (!row) return null;
  return subjectFor(row.user_id, row.guest_key);
}

/** The columns to write for a subject, so no two callers can disagree. */
export function subjectColumns(subject: MeetingSubject): { user_id: string | null; guest_key: string | null } {
  return subject.kind === "member"
    ? { user_id: subject.userId, guest_key: null }
    : { user_id: null, guest_key: subject.guestKey };
}
