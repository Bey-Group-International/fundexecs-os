// Correcting one transcript line. Host only. The correction is kept beside
// the line, which is never rewritten: the words as heard stay readable, and
// sending no text (or the original) removes the correction.
import { NextRequest, NextResponse } from "next/server";
import { requireMeetingHost } from "../../../follow-up/host.server";
import { cleanLineText } from "@/lib/meetings/transcript-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; lineId: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(req: NextRequest, { params }: { params: Params }) {
  const { id, lineId } = await params;
  if (!UUID.test(lineId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const access = await requireMeetingHost(id);
  if (!access.ok) return access.response;
  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  const text = body.text === null || body.text === "" ? null : cleanLineText(body.text);
  if (body.text !== null && body.text !== "" && !text) return NextResponse.json({ error: "Say what was said." }, { status: 422 });

  // The line must be this meeting's: a host corrects their own transcript only.
  const { data: line } = await access.db
    .from("live_meeting_transcripts")
    .select("id, text")
    .eq("id", lineId)
    .eq("meeting_id", id)
    .maybeSingle();
  const stored = line as { id: string; text: string } | null;
  if (!stored) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const edits = access.db.from("live_meeting_transcript_edits");
  const revert = text === null || text === stored.text;
  const { error } = revert
    ? await edits.delete().eq("line_id", lineId)
    : await edits.upsert(
        { line_id: lineId, meeting_id: id, text, edited_by: access.userId, edited_at: new Date().toISOString() },
        { onConflict: "line_id" },
      );
  if (error) {
    const missing = (error as { code?: string }).code === "42P01";
    return NextResponse.json(
      { error: missing ? "Correcting the transcript isn't available yet — try again in a few minutes." : "Could not save the correction." },
      { status: missing ? 503 : 500 },
    );
  }
  return NextResponse.json({ lineId, text: revert ? stored.text : text, original: revert ? null : stored.text });
}
