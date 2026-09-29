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
import { loggedMeeting, toLogEntry, type LoggedMeeting } from "@/lib/meetings/meeting-log";
import { MIN_QUERY } from "@/lib/meetings/transcript-search";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import type { SessionHit } from "@/lib/meetings/session-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How often one person may ask this.
 *
 * Raised by CodeRabbit's architecture pass on this PR, and it is the right
 * question: one request here reads up to two hundred rows carrying transcripts of
 * up to 120,000 characters each and runs a substring scan over them. The calls
 * archive does the same work but only over what ONE person recorded; this is
 * every meeting in the organisation, and any member can ask.
 *
 * Keyed on the user rather than the IP. The caller is authenticated, so the user
 * is both the precise bucket — an office behind one address is many people — and
 * the one that cannot be varied per request.
 *
 * Thirty a minute is far above a person typing: the box debounces at 250ms and
 * only fires when the query changes, so continuous typing produces a handful.
 */
const SEARCH_LIMIT = 30;
const SEARCH_WINDOW_MS = 60_000;

/** A matched meeting: the row the list draws, plus why it is here. */
export interface LoggedMeetingHit extends LoggedMeeting {
  hit: Pick<SessionHit, "reason" | "matches" | "snippet">;
}

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // After the auth gate, so an unauthenticated flood is refused at 401 without
  // consuming somebody's budget, and before the query runs, which is the work
  // being limited.
  const limit = checkRateLimit({
    key: `meeting-log-search:${auth.ctx.userId}`,
    limit: SEARCH_LIMIT,
    windowMs: SEARCH_WINDOW_MS,
  });
  if (!limit.ok) return rateLimitResponse(limit, SEARCH_LIMIT) as NextResponse;

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

  // Shaped, not filtered: `searchMeetingLog` already applies `belongsInLog`, the
  // same rule the page applies to the list, and it has to — it is the only place
  // that can see the rows it REJECTED, which is what `scanned` counts.
  const meetings: LoggedMeetingHit[] = found.rows.map((row) => ({
    ...loggedMeeting(toLogEntry(row.meeting, row.report, row.attended, row.isHost)),
    hit: row.hit ?? { reason: "metadata", matches: 0, snippet: null },
  }));

  return NextResponse.json(
    {
      meetings,
      // How many LOGGED meetings were considered, and whether the scan stopped
      // early. Sent even when there are hits: the reader may be looking for an
      // older one, and a confident count invites them to stop.
      scanned: found.scanned,
      bounded: found.bounded,
    },
    // A search result is about rows that change; a cached one would answer a
    // later question with an earlier archive.
    { headers: { "Cache-Control": "no-store" } },
  );
}
