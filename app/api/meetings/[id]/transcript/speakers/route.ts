// Naming a speaker: "Speaker 2" becomes the person it was, everywhere the
// transcript is read. Host only. The label as heard is kept; clearing the
// name puts it back.
import { NextRequest, NextResponse } from "next/server";
import { requireMeetingHost } from "../../follow-up/host.server";
import { cleanSpeakerName } from "@/lib/meetings/transcript-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function PUT(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const access = await requireMeetingHost(id);
  if (!access.ok) return access.response;
  const body = (await req.json().catch(() => ({}))) as { original?: unknown; display?: unknown };
  const original = typeof body.original === "string" ? body.original.trim().slice(0, 200) : "";
  if (!original) return NextResponse.json({ error: "Which speaker?" }, { status: 400 });
  const display = body.display === null || body.display === "" ? null : cleanSpeakerName(body.display);
  if (body.display !== null && body.display !== "" && !display) {
    return NextResponse.json({ error: "Give the speaker a name." }, { status: 422 });
  }

  const table = access.db.from("live_meeting_speaker_names");
  const { error } =
    display === null || display === original
      ? await table.delete().eq("meeting_id", id).eq("original", original)
      : await table.upsert(
          { meeting_id: id, original, display, updated_by: access.userId, updated_at: new Date().toISOString() },
          { onConflict: "meeting_id,original" },
        );
  if (error) {
    const missing = (error as { code?: string }).code === "42P01";
    return NextResponse.json(
      { error: missing ? "Renaming speakers isn't available yet — try again in a few minutes." : "Could not save the name." },
      { status: missing ? 503 : 500 },
    );
  }
  return NextResponse.json({ original, display: display === original ? null : display });
}
