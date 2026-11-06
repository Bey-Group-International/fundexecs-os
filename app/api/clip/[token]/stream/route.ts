// A shared clip's bytes. Answers only Range requests that fall entirely inside
// the parts the clip may serve, so the link cannot be walked into the rest of
// the recording.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { RECORDING_BUCKET } from "@/lib/meetings/recording-policy";
import { contentRangeHeader, parseRange, rangeLength, slicesForRange, totalSize, type RecordingChunk } from "@/lib/meetings/recording-range";
import { readAllRecordingParts } from "@/lib/meetings/recording-parts";
import { buildTimeline, type StoredPart } from "@/lib/meetings/recording-timeline";
import { partsForWindow, rangeAllowed } from "@/lib/meetings/recording-share";
import { resolveShare } from "@/lib/meetings/recording-share.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A clip is a handful of parts, fetched a few at a time as it plays.
const LIMIT = 240;
const WINDOW_MS = 60_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limit = checkRateLimit({ key: `clip-stream:${clientIp(req)}`, limit: LIMIT, windowMs: WINDOW_MS });
  if (!limit.ok) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: rateLimitHeaders(limit, LIMIT) });
  if (!hasSupabaseServiceEnv()) return NextResponse.json({ error: "Not available" }, { status: 503 });

  const { token } = await params;
  const service = createServiceClient();
  const resolved = await resolveShare(service, token);
  if ("failure" in resolved) {
    return NextResponse.json({ error: "This link is no longer available." }, { status: resolved.failure === "not_found" ? 404 : 410 });
  }

  const rows = await readAllRecordingParts<StoredPart & RecordingChunk>(service as never, resolved.share.recording_id, "idx, path, size, offset_ms, duration_ms");
  const chunks: RecordingChunk[] = [...rows].sort((a, b) => a.idx - b.idx).map((r) => ({ path: r.path, size: r.size }));
  const allowed = partsForWindow(buildTimeline(rows), { startMs: resolved.share.start_ms, endMs: resolved.share.end_ms });
  const size = totalSize(chunks);

  const range = parseRange(req.headers.get("range"), size);
  if (!range) return NextResponse.json({ error: "A clip is played a part at a time." }, { status: 416 });
  if (!rangeAllowed(allowed, range.start, range.end)) {
    return NextResponse.json({ error: "That part of the recording isn't in this clip." }, { status: 403 });
  }

  const storage = service.storage.from(RECORDING_BUCKET);
  const slices = slicesForRange(chunks, range);
  const parts: Uint8Array[] = [];
  for (const slice of slices) {
    const { data, error } = await storage.download(slice.path);
    if (error || !data) return NextResponse.json({ error: "Could not read the recording" }, { status: 502 });
    const buffer = new Uint8Array(await data.arrayBuffer());
    parts.push(buffer.subarray(slice.start, Math.min(slice.end, buffer.byteLength)));
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const body = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    body.set(p, at);
    at += p.byteLength;
  }

  return new NextResponse(body, {
    status: 206,
    headers: {
      "Content-Type": resolved.recording.mime_type,
      "Accept-Ranges": "bytes",
      "Content-Length": String(rangeLength(range)),
      "Content-Range": contentRangeHeader(range, size),
      "Cache-Control": "private, max-age=600",
    },
  });
}
