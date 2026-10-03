// lib/meetings/call-archive.server.ts
// Reading the recorded-call archive: one page of it, a search of it, and the
// line the header says about the last month.
//
// The page renders the first page on the server and the route answers every
// request after it — searches, a narrowed range, and "Load more". They used to
// each write the select and the row mapping out, which is two places for the
// longest-recording rule to drift; now both call this.
//
// No `server-only` import, matching the other loaders here: the `.server`
// suffix is the marker.
import type { createServerClient } from "@/lib/supabase/server";
import { ONE_WAY_KIND, readAcknowledgement } from "@/lib/meetings/one-way";
import {
  longestRecording,
  searchCall,
  type ArchivedCall,
  type CallHit,
  type CallStats,
  type RecordingRow,
} from "@/lib/meetings/call-archive";
import { MIN_QUERY } from "@/lib/meetings/transcript-search";
import { hitScanBound, narrowArchive } from "@/lib/meetings/session-archive.server";
import { LIST_PAGE, SEARCH_SCAN } from "@/lib/meetings/session-archive";

type Client = Awaited<ReturnType<typeof createServerClient>>;

export interface CallOwner {
  userId: string;
  orgId: string;
}

export interface CallPageOptions {
  /** What to search for; shorter than MIN_QUERY lists instead. */
  query?: string;
  /** Only calls before this moment — the cursor "Load more" sends. */
  before?: string | null;
  /** Only calls from this moment on — the range picker. */
  since?: string | null;
}

export interface CallPage {
  calls: CallHit[];
  /** Rows read, so the UI can say a search saw only the most recent calls. */
  scanned: number;
  /** Whether a search stopped at its bound. */
  bounded: boolean;
  /** Whether a plain list has more calls past the last one returned. */
  hasMore: boolean;
}

type Row = {
  id: string;
  room_code: string;
  title: string | null;
  created_at: string;
  recording_consent: unknown;
  live_meeting_recordings?: RecordingRow[] | null;
  live_meeting_reports?: Array<{ summary: string | null; full_transcript?: string | null }> | null;
};

/** An ISO timestamp, or null for anything that is not one. */
function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * One page of the archive, or one search of it.
 *
 * Throws on a database error; the route turns that into a 500 and the page
 * into an empty list.
 */
export async function loadCallPage(
  supabase: Client,
  owner: CallOwner,
  opts: CallPageOptions = {},
): Promise<CallPage> {
  const query = (opts.query ?? "").trim();
  const searching = query.length >= MIN_QUERY;
  const before = isoOrNull(opts.before);
  const since = isoOrNull(opts.since);

  // Recordings and reports come with the call in one round trip, through the
  // foreign keys — this is a list view and three queries per row is how a list
  // view becomes slow.
  //
  // Narrowed through the shared clauses rather than written out again. The one
  // that matters is the report embed's own order: regenerating a report INSERTS
  // another row, so an unordered embed can hand back a superseded summary — and,
  // worse, a superseded transcript to search. See session-archive.server.ts.
  let q = narrowArchive(
    supabase
      .from("live_meetings")
      .select(
        "id, room_code, title, created_at, recording_consent, " +
        "live_meeting_recordings(id, duration_seconds, deleted_at), " +
        // Transcripts only when searching. Each is up to 120,000 characters, and
        // the plain list shows the summary.
        (searching ? "live_meeting_reports(summary, full_transcript)" : "live_meeting_reports(summary)"),
      ),
    {
      kind: ONE_WAY_KIND,
      // A call belongs to whoever recorded it, in the organisation they
      // recorded it in — not to the organisation at large.
      visibility: { scope: "host", hostId: owner.userId, organizationId: owner.orgId },
      searching,
      scan: SEARCH_SCAN,
      page: LIST_PAGE,
    },
  );
  // Filters after the order and limit are fine: PostgREST builds one query
  // string, and the order of the clauses in it does not matter.
  if (before) q = q.lt("created_at", before);
  if (since) q = q.gte("created_at", since);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Row[];
  const calls: CallHit[] = [];
  for (const row of rows) {
    const longest = longestRecording(row.live_meeting_recordings);
    const base: ArchivedCall = {
      id: row.id,
      roomCode: row.room_code,
      title: row.title?.trim() || "Call",
      at: row.created_at,
      durationSeconds: longest?.seconds ?? null,
      recordingId: longest?.id ?? null,
      summary: (row.live_meeting_reports?.[0]?.summary ?? "").trim(),
      consented: readAcknowledgement(row.recording_consent) !== null,
    };
    if (!searching) {
      calls.push({ ...base, matches: 0, snippet: null });
      continue;
    }
    // The transcript the report kept — the same text the report page searches,
    // so a call found here shows the hit in the same place when opened.
    const hit = searchCall(base, row.live_meeting_reports?.[0]?.full_transcript ?? "", query);
    if (hit) calls.push(hit);
  }

  return {
    calls: calls.slice(0, LIST_PAGE),
    scanned: rows.length,
    bounded: hitScanBound(rows.length, { searching, scan: SEARCH_SCAN }),
    // A full page may be followed by more. One that came up short was the end.
    // A search never pages: it reads its bound and says so.
    hasMore: !searching && rows.length >= LIST_PAGE,
  };
}

/** The window the header summarises. */
export const STATS_DAYS = 30;

/**
 * How much was recorded in the last thirty days.
 *
 * Thirty days rather than "this month" because the server does not know the
 * reader's time zone, and a month boundary drawn in UTC is wrong for half the
 * world for part of every first day. A rolling window has no boundary to get
 * wrong. Null on any error: the header simply says nothing.
 */
export async function loadCallStats(
  supabase: Client,
  owner: CallOwner,
  now: Date = new Date(),
): Promise<CallStats | null> {
  const since = new Date(now.getTime() - STATS_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("live_meetings")
    .select("id, live_meeting_recordings(id, duration_seconds, deleted_at)")
    .eq("host_id", owner.userId)
    .eq("organization_id", owner.orgId)
    .eq("kind", ONE_WAY_KIND)
    .is("deleted_at", null)
    .gte("created_at", since)
    // A month of calls is a few dozen; the cap is only a guard.
    .limit(1000);
  if (error) return null;
  const rows = (data ?? []) as unknown as Array<{ live_meeting_recordings?: RecordingRow[] | null }>;
  let seconds = 0;
  for (const row of rows) seconds += longestRecording(row.live_meeting_recordings)?.seconds ?? 0;
  return { count: rows.length, seconds, days: STATS_DAYS };
}
