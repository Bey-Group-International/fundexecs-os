// A shared clip's bytes: the clip's own file, a Range at a time for the
// player, whole for a browser that plays it plainly, and as an attachment only
// when the link's creator allowed saving a copy. Nothing outside the clip —
// which was cut on the server — can be asked for.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { RECORDING_BUCKET } from "@/lib/meetings/recording-policy";
import { contentRangeHeader, parseRange, rangeLength, slicesForRange, totalSize, type RecordingChunk } from "@/lib/meetings/recording-range";
import { clipFilename } from "@/lib/meetings/recording-share";
import {
  CLIP_ROUTE_LIMITS,
  clipReady,
  clipTimeline,
  guardClipRequest,
  noteMiss,
  recordView,
  resolveShare,
} from "@/lib/meetings/recording-share.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Range requests for one link per minute, from everyone together. */
const PER_LINK_LIMIT = 1200;

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req);
  const limited = guardClipRequest(ip, "stream");
  if (limited) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimitHeaders(limited, CLIP_ROUTE_LIMITS.stream) });
  if (!hasSupabaseServiceEnv()) return NextResponse.json({ error: "Not available" }, { status: 503 });

  const { token } = await params;
  const service = createServiceClient();
  const resolved = await resolveShare(service, token);
  if ("failure" in resolved) {
    if (resolved.failure === "not_found") noteMiss(ip);
    return NextResponse.json({ error: "This link is no longer available." }, { status: resolved.failure === "not_found" ? 404 : 410 });
  }
  const perLink = checkRateLimit({ key: `clip-link:${resolved.share.id}`, limit: PER_LINK_LIMIT, windowMs: 60_000 });
  if (!perLink.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimitHeaders(perLink, PER_LINK_LIMIT) });
  if (!clipReady(resolved.share)) return NextResponse.json({ error: "This clip is still being prepared." }, { status: 409 });

  const download = new URL(req.url).searchParams.get("download") === "1";
  if (download && resolved.share.allow_download !== true) {
    return NextResponse.json({ error: "Saving a copy of this clip isn't allowed." }, { status: 403 });
  }

  const { parts, paths } = await clipTimeline(service, resolved.share.id);
  const chunks: RecordingChunk[] = parts.map((p) => ({ path: paths.get(p.idx) ?? "", size: p.end - p.start }));
  if (!chunks.length || chunks.some((c) => !c.path)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const size = totalSize(chunks);

  const asked = download ? null : parseRange(req.headers.get("range"), size);
  const wanted = asked ?? { start: 0, end: size - 1 };
  const slices = slicesForRange(chunks, wanted);
  if (download) await recordView(service, resolved.share, { ip, userAgent: req.headers.get("user-agent") }, "download");

  const storage = service.storage.from(RECORDING_BUCKET);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const slice = slices.shift();
      if (!slice) {
        controller.close();
        return;
      }
      const { data, error } = await storage.download(slice.path);
      if (error || !data) {
        // A truncated clip rather than a wrong one; nothing better can be said mid-body.
        controller.close();
        slices.length = 0;
        return;
      }
      const buffer = new Uint8Array(await data.arrayBuffer());
      controller.enqueue(buffer.subarray(slice.start, Math.min(slice.end, buffer.byteLength)));
    },
    cancel() {
      slices.length = 0;
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": resolved.recording.mime_type,
    "Accept-Ranges": "bytes",
    "Content-Length": String(rangeLength(wanted)),
    // Short: a link that is turned off should stop playing soon, even from cache.
    "Cache-Control": "private, max-age=60",
    "Content-Disposition": download
      ? `attachment; filename="${clipFilename(resolved.recording.started_at, resolved.recording.mime_type)}"`
      : "inline",
    "X-Content-Type-Options": "nosniff",
  };
  if (asked) headers["Content-Range"] = contentRangeHeader(asked, size);
  return new NextResponse(stream as unknown as BodyInit, { status: asked ? 206 : 200, headers });
}
