// app/api/meetings/log/search/route.ts
// Searching the meeting log by what was said in the meeting.
//
// The log used to search in the browser: the page shipped every entry's prose
// and `String.includes` filtered it. That could not answer the question a log is
// for — "what did we agree with Dunbar in March" — because the words are in the
// transcript, and a transcript is never shipped to a list.
//
// So the search runs where the transcripts are. Same engine as the recorded-call
// archive (session-archive.ts), same bound, and the same duty to say when the
// bound bit.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { searchMeetingLog } from "@/lib/meetings/meeting-log.server";
import { belongsInLog, loggedMeeting, toLogEntry, type LoggedMeeting } from "@/lib/meetings/meeting-log";
import { MIN_QUERY } from "@/lib/meetings/transcript-search";
import type { SessionHit } from "@/lib/meetings/session-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A matched meeting: the row the list draws, plus why it is here. */
export interface LoggedMeetingHit extends LoggedMeeting {
  hit: Pick<SessionHit, "reason" | "matches" | "snippet">;
}

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const query = (req.nextUrl.searchParams.get("q") ?? "").trim();
  // A one-character query matches most transcripts, which is the same as no
  // filter and a great deal more reading. Refused rather than answered with
  // everything, so the client cannot mistake it for a result.
  if (query.length < MIN_QUERY) {
    return NextResponse.json(
      { error: `Type at least ${MIN_QUERY} characters` },
      { status: 400 },
    );
  }

  const supabase = await createServerClient();
  const found = await searchMeetingLog(supabase, auth.ctx.orgId, auth.ctx.userId, query);

  // The same rule the page applies to the list. A hit the list does not show
  // would be the only place that meeting appears in the product.
  const now = Date.now();
  const meetings: LoggedMeetingHit[] = found.rows
    .filter((row) => belongsInLog(row.meeting, now))
    .map((row) => ({
      ...loggedMeeting(toLogEntry(row.meeting, row.report, row.attended, row.isHost)),
      hit: row.hit ?? { reason: "metadata", matches: 0, snippet: null },
    }));

  return NextResponse.json(
    {
      meetings,
      // What was read, and whether that was everything. Sent even when there
      // are hits: the reader may be looking for an older one, and a confident
      // count invites them to stop.
      scanned: found.scanned,
      bounded: found.bounded,
    },
    // A search result is about rows that change; a cached one would answer a
    // later question with an earlier archive.
    { headers: { "Cache-Control": "no-store" } },
  );
}
