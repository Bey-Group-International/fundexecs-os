// app/api/meetings/log/[meetingId]/route.ts
// The prose behind one log row, fetched when the row is opened.
//
// The log lists a line per meeting — title, date, and how many points,
// decisions and actions the report holds. The sentences themselves are here,
// because two hundred rows of prose shipped so that one open row can show its
// summary is two hundred rows of prose nobody reads.
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadLogDetail } from "@/lib/meetings/meeting-log.server";
import { meetingLogDetail, toLogEntry } from "@/lib/meetings/meeting-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { meetingId } = await params;
  const supabase = await createServerClient();
  const row = await loadLogDetail(supabase, auth.ctx.orgId, auth.ctx.userId, meetingId);
  if (!row) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  // Not a 404. Reports are for the host and the people who joined — RLS says so
  // too, and would hand back an empty report here — but "not found" would have
  // the log denying a meeting exists that it is itself listing. The reader is
  // told whose it is to ask for instead.
  if (!row.attended) {
    return NextResponse.json(
      { error: "You weren’t in this meeting, so its report isn’t yours to read." },
      { status: 403 },
    );
  }

  const detail = meetingLogDetail(
    toLogEntry(row.meeting, row.report, row.attended, row.isHost),
  );

  return NextResponse.json({ detail }, { headers: { "Cache-Control": "no-store" } });
}
