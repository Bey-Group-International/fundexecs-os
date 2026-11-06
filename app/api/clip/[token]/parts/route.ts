// A shared clip's timeline: only the parts inside its window (and the first,
// which carries the stream's header). See recording-share.ts.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { timelineBytes } from "@/lib/meetings/recording-timeline";
import { clipTimeline, resolveShare } from "@/lib/meetings/recording-share.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 60;
const WINDOW_MS = 60_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limit = checkRateLimit({ key: `clip-parts:${clientIp(req)}`, limit: LIMIT, windowMs: WINDOW_MS });
  if (!limit.ok) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: rateLimitHeaders(limit, LIMIT) });
  if (!hasSupabaseServiceEnv()) return NextResponse.json({ error: "Not available" }, { status: 503 });

  const { token } = await params;
  const service = createServiceClient();
  const resolved = await resolveShare(service, token);
  if ("failure" in resolved) {
    return NextResponse.json({ error: "This link is no longer available." }, { status: resolved.failure === "not_found" ? 404 : 410 });
  }
  const { all, allowed } = await clipTimeline(service, resolved);
  if (!allowed.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const last = all[all.length - 1];
  return NextResponse.json(
    {
      mimeType: resolved.recording.mime_type,
      status: "complete",
      startedAt: resolved.recording.started_at,
      // The recording's real length, so the clip sits at its true place on the clock.
      durationMs: last ? last.offsetMs + last.durationMs : 0,
      totalBytes: timelineBytes(all),
      parts: allowed.map((p) => ({ idx: p.idx, start: p.start, end: p.end, offsetMs: p.offsetMs, durationMs: p.durationMs })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
