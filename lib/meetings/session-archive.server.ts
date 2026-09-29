// lib/meetings/session-archive.server.ts
// The clauses both halves of the archive need, in one place.
//
// WHAT IS SHARED HERE AND WHAT IS NOT, because the line matters.
//
// NOT shared: the select. A recorded call carries its consent record and its
// recording's length; a meeting carries its attendees and a wall clock. Forcing
// one select over both would be more abstraction than two call sites justify,
// and supabase-js parses the select string at the type level — a string it cannot
// read as a literal takes those column checks with it.
//
// Shared: the narrowing. Five clauses, and one of them is subtly wrong when got
// wrong in a way no test of the happy path notices — see the report embed below.
// That is the part worth having in one place.
//
// No `server-only` import, matching the other loaders here: the `.server` suffix
// is the marker, and the guard would put this beyond the reach of a test.
import { SEARCH_SCAN, LIST_PAGE, type SessionKind, type SessionVisibility } from "@/lib/meetings/session-archive";

/**
 * The shape of the clauses this applies, as the narrowest thing that works.
 *
 * Typed loosely on purpose and contained to this file: the Postgrest builder's
 * type is enormous and threading it through a generic gains nothing here, since
 * every method used returns the same builder.
 */
interface Narrowable {
  eq(column: string, value: unknown): Narrowable;
  is(column: string, value: unknown): Narrowable;
  order(column: string, opts?: { ascending?: boolean; referencedTable?: string }): Narrowable;
  limit(count: number, opts?: { referencedTable?: string }): Narrowable;
}

export interface ArchiveNarrowing {
  kind: SessionKind;
  visibility: SessionVisibility;
  /** Whether this read is a search, which decides how deep it goes. */
  searching: boolean;
  /** Rows a search reads. Defaults to the shared scan bound. */
  scan?: number;
  /** Rows a plain list shows. Defaults to the shared page size. */
  page?: number;
}

/**
 * Apply the clauses every archive read needs.
 *
 * Returns the same builder, so it composes: `narrowArchive(supabase.from(...)
 * .select(mySelect), opts)`.
 *
 * THE ONE THAT BITES is the report embed's own order and limit. Regenerating a
 * report INSERTS another row rather than updating the old one, so a meeting can
 * have several — and an embed with no order on it hands back whichever Postgres
 * feels like. That means a superseded SUMMARY in a list, which is visible and
 * annoying, and a superseded TRANSCRIPT to search, which is invisible: the search
 * reads words nobody said any more and misses the ones they did. Ordering the
 * embed newest-first and taking one is the whole fix, and it has to be on every
 * read rather than remembered at each.
 */
export function narrowArchive<Q extends Narrowable>(query: Q, opts: ArchiveNarrowing): Q {
  let q: Narrowable = query;

  // Visibility first, because it is the clause that must never be forgotten. It
  // travels as data (see SessionVisibility) so that sharing this function cannot
  // quietly share a permission rule between a private call and a listed meeting.
  if (opts.visibility.scope === "host") {
    q = q.eq("host_id", opts.visibility.hostId);
  } else {
    q = q.eq("organization_id", opts.visibility.organizationId);
  }

  q = q
    .eq("kind", opts.kind)
    .is("deleted_at", null)
    // Newest first: an archive is read from the recent end, and the bound below
    // means this order decides what a bounded search got to look at.
    .order("created_at", { ascending: false })
    .order("created_at", { ascending: false, referencedTable: "live_meeting_reports" })
    .limit(1, { referencedTable: "live_meeting_reports" })
    .limit(opts.searching ? (opts.scan ?? SEARCH_SCAN) : (opts.page ?? LIST_PAGE));

  return q as Q;
}

/**
 * Whether a read hit its scan bound, and therefore did not see everything.
 *
 * `>=` rather than `===` because a driver that returns the limit plus nothing is
 * still a full page, and because an off-by-one here turns into a UI that claims
 * to have searched the whole archive.
 *
 * Only ever true for a search: a plain list showing its first page has not
 * failed to find anything.
 */
export function hitScanBound(rows: number, opts: { searching: boolean; scan?: number }): boolean {
  if (!opts.searching) return false;
  return rows >= (opts.scan ?? SEARCH_SCAN);
}

/**
 * The transcript columns to embed, which depend on whether this is a search.
 *
 * Each stored transcript is up to 120,000 characters. A list shows the summary,
 * so reading the transcript for a plain page load moved megabytes nobody looked
 * at — hence two shapes rather than one convenient one.
 *
 * Returned as a literal union so callers can inline it into a select string and
 * keep supabase-js's column checking.
 */
export function reportEmbed(searching: boolean): string {
  return searching
    ? "live_meeting_reports(summary, key_points, action_items, analysis, has_transcript, full_transcript, created_at)"
    : "live_meeting_reports(summary, key_points, action_items, analysis, has_transcript, created_at)";
}
