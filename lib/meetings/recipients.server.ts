// lib/meetings/recipients.server.ts
// Turning attendance rows into people you can write to.
//
// `live_meeting_participants` records who crossed the threshold into a meeting,
// and it records them by user id and display name — there is no address on the
// row. So every consumer of it so far has used it as a boolean ("was this
// person here?") and thrown the identities away, which is why both email paths
// ended up addressing the invite list instead: it was the only place in the
// schema with an address on it.
//
// The addresses are one join away, in `principals`. Read through the caller's
// own client, so the same RLS that lets an org member see who was in a meeting
// is what lets them write to them — rather than a second access rule that could
// drift away from the first.
//
// Split from recipients.ts so the rules stay testable without a database.

import { logId } from "@/lib/log-safe";
import type { createServerClient } from "@/lib/supabase/server";
import type { PresentPerson } from "@/lib/meetings/recipients";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

/**
 * Attendance rows one meeting's recipients are built from.
 *
 * `normalizeAttendees` caps an invite list at 100 and a room nobody can fit in
 * is not a meeting, so this is a ceiling on a pathological row count rather
 * than a paging boundary — a meeting that reaches it is a bug somewhere else,
 * and it says so rather than quietly addressing the first two hundred.
 */
export const PRESENT_LIMIT = 200;

/**
 * Everybody who was in this meeting, with an address where there is one.
 *
 * Never throws. An export or an email must not fail because an attendance
 * lookup did; the worst case is the behaviour that existed before this
 * function, which is the invite list on its own.
 */
export async function loadPresentPeople(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<PresentPerson[]> {
  try {
    const { data, error } = await supabase
      .from("live_meeting_participants")
      .select("user_id, display_name, joined_at")
      .eq("meeting_id", meetingId)
      // Oldest first, so the order people appear in is the order they arrived —
      // which puts the host at the top of a participant list, where a reader
      // expects them.
      .order("joined_at", { ascending: true })
      .limit(PRESENT_LIMIT + 1);

    if (error) {
      console.warn("[recipients] attendance lookup failed", error.message);
      return [];
    }

    const rows = (data ?? []) as Array<{ user_id: string | null; display_name: string | null }>;
    if (rows.length > PRESENT_LIMIT) {
      // Said rather than swallowed: the alternative is an email that reaches
      // two hundred of the people in a meeting and reports itself complete.
      console.warn("[recipients] attendance row count over the ceiling", {
        meetingId: logId(meetingId),
        rows: rows.length,
      });
    }

    // One entry per person. The unique index on (meeting_id, user_id) makes the
    // member case redundant — but Postgres treats NULLs as distinct, so guest
    // rows are not constrained by it, and a rejoin under a new guest key would
    // otherwise be reported as a second person nobody could reach.
    const seen = new Set<string>();
    const people: PresentPerson[] = [];
    /** Where to write each member's address once the directory is read. */
    const byUser = new Map<string, PresentPerson>();

    for (const row of rows.slice(0, PRESENT_LIMIT)) {
      const name = (row.display_name ?? "").trim();
      const key = row.user_id ?? `guest:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The address is filled in below. A guest has no user id and therefore no
      // directory row, and stays null — which is the honest answer, and the one
      // the caller reports to the host rather than dropping them.
      const person: PresentPerson = { name: name || "Guest", email: null };
      people.push(person);
      if (row.user_id) byUser.set(row.user_id, person);
    }

    if (byUser.size === 0) return people;

    const { data: principals, error: directoryError } = await supabase
      .from("principals")
      .select("id, email, full_name")
      .in("id", [...byUser.keys()]);

    if (directoryError) {
      // Names without addresses. The caller reports them as people it could not
      // reach, which is exactly what has happened.
      console.warn("[recipients] directory lookup failed", directoryError.message);
      return people;
    }

    for (const row of (principals ?? []) as Array<{
      id: string;
      email: string | null;
      full_name: string | null;
    }>) {
      const person = byUser.get(row.id);
      if (!person) continue;
      const email = (row.email ?? "").trim().toLowerCase();
      if (email) person.email = email;
      // The directory's name beats the one typed into a join screen: it is the
      // name the organisation knows them by, and the one that belongs on an
      // email rather than "sarah (phone)".
      const full = (row.full_name ?? "").trim();
      if (full) person.name = full;
    }

    return people;
  } catch (err) {
    console.warn("[recipients] attendance lookup threw", err);
    return [];
  }
}
