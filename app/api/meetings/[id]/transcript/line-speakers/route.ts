// Saying who actually spoke some transcript lines, for rooms that shared one
// microphone: every line from that device is stored under its owner's name.
// Host only. The lines themselves are never rewritten; the name is kept beside
// them, and sending no speaker (or the speaker as heard) puts them back.
import { NextRequest, NextResponse } from "next/server";
import { requireMeetingHost } from "../../follow-up/host.server";
import { cleanSpeakerName } from "@/lib/meetings/transcript-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * A turn is rarely longer; a bigger ask is a mistake, not a request. Not
 * exported: a Next.js route file may export only its handlers and config.
 */
const MAX_LINES = 200;

export async function PUT(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const access = await requireMeetingHost(id);
  if (!access.ok) return access.response;
  const body = (await req.json().catch(() => ({}))) as { lineIds?: unknown; speaker?: unknown };

  const raw = Array.isArray(body.lineIds) ? body.lineIds : [];
  const lineIds = [...new Set(raw.filter((v): v is string => typeof v === "string" && UUID.test(v)))];
  if (!lineIds.length || lineIds.length !== raw.length) return NextResponse.json({ error: "Which lines?" }, { status: 400 });
  if (lineIds.length > MAX_LINES) return NextResponse.json({ error: `Pick at most ${MAX_LINES} lines at a time.` }, { status: 422 });

  const speaker = body.speaker === null || body.speaker === "" ? null : cleanSpeakerName(body.speaker);
  if (body.speaker !== null && body.speaker !== "" && !speaker) {
    return NextResponse.json({ error: "Give the speaker a name." }, { status: 422 });
  }

  // Every line must be this meeting's: a host reassigns their own transcript only.
  const { data: found } = await access.db
    .from("live_meeting_transcripts")
    .select("id, speaker")
    .eq("meeting_id", id)
    .in("id", lineIds);
  const lines = (found ?? []) as Array<{ id: string; speaker: string | null }>;
  if (lines.length !== lineIds.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const table = access.db.from("live_meeting_line_speakers");
  const now = new Date().toISOString();
  // Lines already stored under that name need no overlay; clear any they had.
  const keep = speaker ? lines.filter((l) => (l.speaker ?? "").trim() !== speaker) : [];
  const clear = lines.filter((l) => !keep.includes(l)).map((l) => l.id);

  const writes = [];
  if (keep.length) {
    writes.push(
      table.upsert(
        keep.map((l) => ({ line_id: l.id, meeting_id: id, speaker, assigned_by: access.userId, assigned_at: now })),
        { onConflict: "line_id" },
      ),
    );
  }
  if (clear.length) writes.push(table.delete().eq("meeting_id", id).in("line_id", clear));
  const results = await Promise.all(writes);
  const error = results.map((r) => (r as { error?: unknown }).error).find(Boolean);
  if (error) {
    const missing = (error as { code?: string }).code === "42P01";
    return NextResponse.json(
      { error: missing ? "Naming who spoke isn't available yet — try again in a few minutes." : "Could not save who spoke." },
      { status: missing ? 503 : 500 },
    );
  }
  // What the room heard for each line, so a page can put a line back as it was.
  const heard = Object.fromEntries(lines.map((l) => [l.id, (l.speaker ?? "").trim()]));
  return NextResponse.json({ lineIds, speaker: keep.length ? speaker : null, heard });
}
