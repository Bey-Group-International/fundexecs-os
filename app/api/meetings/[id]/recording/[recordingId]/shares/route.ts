// The host's clips of one recording: list them, and make a new one.
//
// Read and written through the caller's own client: the insert policy is what
// says only the meeting's host may share its recording, and the read policy
// shows each person only the links they made. Once the link exists the clip
// is cut into a file of its own on the server (after the response), and the
// link plays once that is done — see lib/meetings/recording-clip.server.ts.
import { NextRequest, NextResponse, after } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { readAllRecordingParts } from "@/lib/meetings/recording-parts";
import { buildTimeline, timelineDuration, type StoredPart } from "@/lib/meetings/recording-timeline";
import { cleanDays, cleanLabel, cleanWindow } from "@/lib/meetings/recording-share";
import { SHARE_COLUMNS, clipUrl, hashShareToken, newShareToken, serializeShare, type ShareRow } from "@/lib/meetings/recording-share.server";
import { buildClip } from "@/lib/meetings/recording-clip.server";
import { canClip } from "@/lib/meetings/webm-clip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cutting a clip of up to twenty minutes runs after the response, inside this budget.
export const maxDuration = 300;

const CREATE_LIMIT = 20;
const CREATE_WINDOW_MS = 10 * 60_000;

type Params = Promise<{ id: string; recordingId: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { recordingId } = await params;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("recording_shares")
    .select(SHARE_COLUMNS)
    .eq("recording_id", recordingId)
    .order("created_at", { ascending: false })
    .limit(50);
  // Before the table exists this is empty rather than an error: nothing has been shared.
  if (error) return NextResponse.json({ shares: [] });
  return NextResponse.json({ shares: ((data ?? []) as ShareRow[]).map(serializeShare) });
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id, recordingId } = await params;
  const limit = checkRateLimit({ key: `clip-create:${auth.ctx.userId}`, limit: CREATE_LIMIT, windowMs: CREATE_WINDOW_MS });
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many links made at once. Wait a few minutes." }, { status: 429, headers: rateLimitHeaders(limit, CREATE_LIMIT) });
  }
  const body = (await req.json().catch(() => ({}))) as {
    startMs?: unknown;
    endMs?: unknown;
    label?: unknown;
    days?: unknown;
    allowDownload?: unknown;
  };

  const supabase = await createServerClient();

  // Only the host shares. Asked here as well as in the policy so the answer
  // is a sentence rather than a failed insert.
  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, organization_id")
    .eq("id", id)
    .eq("host_id", auth.ctx.userId)
    .maybeSingle();
  if (!meeting) return NextResponse.json({ error: "Only the meeting's host can share its recording." }, { status: 403 });

  const { data: rec } = await supabase
    .from("live_meeting_recordings")
    .select("id, deleted_at, mime_type")
    .eq("id", recordingId)
    .eq("meeting_id", id)
    .maybeSingle();
  const recording = rec as { id: string; deleted_at: string | null; mime_type: string | null } | null;
  if (!recording) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (recording.deleted_at) return NextResponse.json({ error: "This recording has been deleted." }, { status: 410 });
  if (!canClip(recording.mime_type)) {
    return NextResponse.json(
      { error: "Clips can only be cut from WebM recordings. This one was recorded in Safari — download it to share a part." },
      { status: 422 },
    );
  }
  if (!hasSupabaseServiceEnv()) return NextResponse.json({ error: "Sharing clips isn't available right now." }, { status: 503 });

  let durationMs = 0;
  try {
    durationMs = timelineDuration(buildTimeline(await readAllRecordingParts<StoredPart>(supabase, recordingId, "idx, size, offset_ms, duration_ms")));
  } catch {
    return NextResponse.json({ error: "Could not read the recording" }, { status: 500 });
  }
  const window = cleanWindow(body.startMs, body.endMs, durationMs);
  if (!window) return NextResponse.json({ error: "That part of the recording doesn't exist." }, { status: 422 });

  const days = cleanDays(body.days);
  const token = newShareToken();
  const { data, error } = await supabase
    .from("recording_shares")
    .insert({
      token_hash: hashShareToken(token),
      meeting_id: id,
      recording_id: recordingId,
      organization_id: (meeting as { organization_id: string | null }).organization_id,
      created_by: auth.ctx.userId,
      label: cleanLabel(body.label),
      start_ms: window.startMs,
      end_ms: window.endMs,
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      allow_download: body.allowDownload === true,
    } as never)
    .select(SHARE_COLUMNS)
    .single();
  if (error || !data) {
    const missing = (error as { code?: string } | null)?.code === "42P01";
    return NextResponse.json(
      { error: missing ? "Sharing clips isn't available yet — try again in a few minutes." : "Could not create the link." },
      { status: missing ? 503 : 500 },
    );
  }
  const share = data as ShareRow;
  // Cut after answering: the host gets the link at once, and it plays as soon
  // as the clip's file exists. The hourly sweep picks up anything this misses.
  after(async () => {
    await buildClip(createServiceClient(), share.id);
  });
  // The token goes back once, here, and is never readable again.
  return NextResponse.json({ share: serializeShare(share), url: clipUrl(token) });
}
