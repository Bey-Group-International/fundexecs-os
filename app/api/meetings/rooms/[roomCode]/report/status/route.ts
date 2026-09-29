import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { loadReportPage } from "@/lib/meetings/report-page.server";
import { shouldPollReport } from "@/lib/meetings/attendance";

// GET /api/meetings/rooms/[roomCode]/report/status
//
// One question: has this room's report arrived yet, for whoever is asking.
//
// The report page is server-rendered, so the only live thing left on it is the
// wait for a report that a background route writes some seconds after the
// meeting ends. That wait needs something cheap to ask.
//
// Not the export route, which was the obvious candidate and the wrong one: it
// renders the whole document — markdown, then PDF or DOCX — and polling it every
// five seconds would rebuild a report on the server repeatedly to learn one
// boolean.
//
// Read through the user's own session client, so the answer is subject to the
// same RLS as the page itself. A second access rule here could drift away from
// the page's and start telling a non-attendee to keep waiting for something they
// will never be shown.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  const { roomCode } = await params;

  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = await createServerClient();
  const data = await loadReportPage(supabase, roomCode);

  // The same function the page renders from, so "ready" here and "ready" there
  // cannot disagree. `waiting` is the one the poll acts on: it is false for a
  // finished report AND for every terminal state, so a poll stops on
  // "forbidden" or "stalled" rather than asking forever about an answer that
  // will not change.
  return NextResponse.json(
    {
      state: data.state,
      waiting: shouldPollReport(data.state),
      ready: data.state === "ready" || data.state === "unsummarised",
    },
    // Never cached: the entire point is to observe a change.
    { headers: { "Cache-Control": "no-store" } },
  );
}
