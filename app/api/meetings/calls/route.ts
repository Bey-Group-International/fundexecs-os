// app/api/meetings/calls/route.ts
// The recorded calls, and searching what was said in them.
//
// Searching is done here rather than in the browser because the alternative is
// shipping every transcript the organisation has ever recorded to a laptop so
// it can grep them — which is slow on the first call and untenable by the
// fiftieth. Postgres narrows; transcript-search.ts, the same function the
// report page highlights with, decides the matches and the snippet.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ONE_WAY_KIND, readAcknowledgement } from "@/lib/meetings/one-way";
import { searchCall, type ArchivedCall, type CallHit } from "@/lib/meetings/call-archive";
import { MIN_QUERY } from "@/lib/meetings/transcript-search";
import { hitScanBound, narrowArchive } from "@/lib/meetings/session-archive.server";
import { LIST_PAGE, SEARCH_SCAN } from "@/lib/meetings/session-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The page size and the scan bound live in session-archive.ts, with the rules
// that use them: the meeting log searches the same table with the same bound,
// and two numbers meaning "how deep is a search" is how the two halves start
// disagreeing about what "no results" means.

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = await createServerClient();
  const query = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const searching = query.length >= MIN_QUERY;

  // Recordings and reports come with the call in one round trip, through the
  // foreign keys — this is a list view and three queries per row is how a list
  // view becomes slow.
  //
  // Narrowed through the shared clauses rather than written out again. The one
  // that matters is the report embed's own order: regenerating a report INSERTS
  // another row, so an unordered embed can hand back a superseded summary — and,
  // worse, a superseded transcript to search. It used to be remembered here, in
  // the page's own query, and nowhere else. See session-archive.server.ts.
  //
  // The SELECT stays local, and deliberately: a call needs its consent record and
  // its recording's length, which a meeting has no column for, and it needs the
  // summary and nothing else of the report. Sharing the embed would mean reading
  // key points and action items that no row here draws.
  const { data, error } = await narrowArchive(
    supabase
      .from("live_meetings")
      .select(
        "id, room_code, title, created_at, recording_consent, " +
        "live_meeting_recordings(duration_seconds, status, deleted_at), " +
        // Transcripts only when searching. Each is up to 120,000 characters, and
        // the plain list shows the summary — so reading them for every page load
        // moved megabytes nobody looked at.
        (searching ? "live_meeting_reports(summary, full_transcript)" : "live_meeting_reports(summary)"),
      ),
    {
      kind: ONE_WAY_KIND,
      // A call belongs to whoever recorded it, in the organisation they recorded
      // it in — not to the organisation at large, which is what a meeting is.
      visibility: { scope: "host", hostId: auth.ctx.userId, organizationId: auth.ctx.orgId },
      searching,
      scan: SEARCH_SCAN,
      page: LIST_PAGE,
    },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    room_code: string;
    title: string | null;
    created_at: string;
    recording_consent: unknown;
    live_meeting_recordings?: Array<{
      duration_seconds: number | null;
      status: string | null;
      deleted_at: string | null;
    }> | null;
    live_meeting_reports?: Array<{ summary: string | null; full_transcript: string | null }> | null;
  };

  const rows = (data ?? []) as unknown as Row[];
  const calls: CallHit[] = [];

  for (const row of rows) {
    const base: ArchivedCall = {
      id: row.id,
      roomCode: row.room_code,
      title: row.title?.trim() || "Call",
      at: row.created_at,
      durationSeconds: longestRecording(row.live_meeting_recordings),
      summary: (row.live_meeting_reports?.[0]?.summary ?? "").trim(),
      consented: readAcknowledgement(row.recording_consent) !== null,
    };

    if (!searching) {
      calls.push({ ...base, matches: 0, snippet: null });
      continue;
    }

    // The transcript the report kept. Reports hold the merged, restored text,
    // which is the same thing the report page searches — so a call found here
    // is a call whose report will show the hit in the same place.
    const transcript = row.live_meeting_reports?.[0]?.full_transcript ?? "";
    const hit = searchCall(base, transcript, query);
    if (hit) calls.push(hit);
  }

  return NextResponse.json({
    calls: calls.slice(0, LIST_PAGE),
    // What was read, and whether that was everything — so the UI can say the
    // search saw only the most recent calls rather than implying it saw the
    // archive. Sent even when there are hits: the reader may be looking for an
    // older one.
    scanned: rows.length,
    bounded: hitScanBound(rows.length, { searching, scan: SEARCH_SCAN }),
  });
}

/**
 * How long the call ran.
 *
 * The longest surviving recording, not the first: a call stopped and restarted
 * has several, and the first may be the eight seconds before somebody realised
 * the mic was muted. Deleted ones are skipped — their duration describes bytes
 * that are gone.
 */
function longestRecording(
  recordings: Array<{ duration_seconds: number | null; status: string | null; deleted_at: string | null }> | null | undefined,
): number | null {
  let best: number | null = null;
  for (const rec of recordings ?? []) {
    if (rec.deleted_at) continue;
    const seconds = rec.duration_seconds;
    if (typeof seconds !== "number" || seconds <= 0) continue;
    if (best === null || seconds > best) best = seconds;
  }
  return best;
}
