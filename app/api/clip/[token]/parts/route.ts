// A shared clip's timeline: the parts of the clip's own file, cut on the
// server from the recording when the link was made. Nothing of the recording
// outside the clip is reachable from here. See lib/meetings/recording-clip.server.ts.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { timelineBytes } from "@/lib/meetings/recording-timeline";
import { CLIP_ROUTE_LIMITS, clipReady, clipTimeline, guardClipRequest, noteMiss, resolveShare } from "@/lib/meetings/recording-share.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req);
  const limited = guardClipRequest(ip, "parts");
  if (limited) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimitHeaders(limited, CLIP_ROUTE_LIMITS.parts) });
  if (!hasSupabaseServiceEnv()) return NextResponse.json({ error: "Not available" }, { status: 503 });

  const { token } = await params;
  const service = createServiceClient();
  const resolved = await resolveShare(service, token);
  if ("failure" in resolved) {
    if (resolved.failure === "not_found") noteMiss(ip);
    return NextResponse.json({ error: "This link is no longer available." }, { status: resolved.failure === "not_found" ? 404 : 410 });
  }
  if (!clipReady(resolved.share)) {
    return NextResponse.json({ error: "This clip is still being prepared." }, { status: 409, headers: { "Retry-After": "30" } });
  }
  const { parts } = await clipTimeline(service, resolved.share.id);
  if (!parts.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const last = parts[parts.length - 1];
  return NextResponse.json(
    {
      mimeType: resolved.recording.mime_type,
      status: "complete",
      startedAt: resolved.recording.started_at,
      durationMs: last.offsetMs + last.durationMs,
      totalBytes: timelineBytes(parts),
      parts: parts.map((p) => ({ idx: p.idx, start: p.start, end: p.end, offsetMs: p.offsetMs, durationMs: p.durationMs })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
