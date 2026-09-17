// The recording's timeline: what the player needs before it can seek.
//
// The assembled stream is a live-recorded WebM — no duration in its header, no
// cue index — so a browser handed it can play from the start and little else.
// This hands the player the parts instead: where each one sits in the byte
// stream and where it sits on the clock. A seek then becomes "which part holds
// this moment", and the player appends that part through MediaSource.
//
// Authorization is RLS, exactly as the stream route does it: the chunk rows are
// readable only by the host and the people with an attendance row, so a caller
// who was not in the meeting reads no parts and gets the same 404 as a
// recording that does not exist.
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { buildTimeline, timelineBytes, timelineDuration } from "@/lib/meetings/recording-timeline";
import type { StoredPart } from "@/lib/meetings/recording-timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; recordingId: string }>;

export async function GET(_req: Request, { params }: { params: Params }) {
  const { id, recordingId } = await params;
  const rls = await createServerClient();

  const { data: recording } = await rls
    .from("live_meeting_recordings")
    .select("id, mime_type, status, deleted_at, started_at")
    .eq("id", recordingId)
    .eq("meeting_id", id)
    .maybeSingle();

  const rec = recording as
    | { id: string; mime_type: string; status: string; deleted_at: string | null; started_at: string }
    | null;

  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (rec.deleted_at) {
    return NextResponse.json(
      { error: "This recording has passed its retention period and was deleted." },
      { status: 410 },
    );
  }

  const { data: rows } = await rls
    .from("live_meeting_recording_chunks")
    .select("idx, path, size, offset_ms, duration_ms")
    .eq("recording_id", recordingId)
    .order("idx", { ascending: true });

  const parts = buildTimeline((rows ?? []) as StoredPart[]);
  if (parts.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    mimeType: rec.mime_type || "video/webm",
    status: rec.status,
    startedAt: rec.started_at,
    durationMs: timelineDuration(parts),
    totalBytes: timelineBytes(parts),
    // The path is deliberately not sent: the player addresses parts by byte
    // range through the stream route, and a Storage path is not the client's
    // business.
    parts: parts.map((p) => ({
      idx: p.idx,
      start: p.start,
      end: p.end,
      offsetMs: p.offsetMs,
      durationMs: p.durationMs,
    })),
  });
}
