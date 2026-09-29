import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { RECORDING_BUCKET, extensionFor } from "@/lib/meetings/recording-policy";
import {
  capRange,
  contentRangeHeader,
  isOpenEndedRange,
  parseRange,
  PLAYBACK_WINDOW_BYTES,
  rangeLength,
  slicesForRange,
  totalSize,
  type RecordingChunk,
} from "@/lib/meetings/recording-range";
import { readAllRecordingParts } from "@/lib/meetings/recording-parts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Play one meeting recording.
 *
 * The recording is stored as parts — five seconds each, uploaded while the
 * meeting ran so a host's laptop closing costs seconds rather than an hour.
 * Nothing ever stitches them into a single object: Storage cannot concatenate
 * server-side, and pulling hundreds of megabytes through a function to rewrite
 * them would cost more than storing them twice.
 *
 * So this route is the stitch. It presents the parts as one byte stream and
 * answers Range requests by mapping requested bytes onto the parts that hold
 * them, which is what lets a viewer SEEK. Without that a browser can only play
 * an hour-long meeting from the beginning, which is not really watching it.
 *
 * Authorization is RLS, not a check here: `live_meeting_recording_chunks` is
 * readable only by the host and the people with an attendance row, so a caller
 * who was not in the meeting reads no parts and gets a 404. Deliberately the
 * same answer as a recording that does not exist.
 */

type Params = Promise<{ id: string; recordingId: string }>;

/** Bytes pulled per part. Parts are ~940KB; this is the ceiling, not the norm. */
const MAX_PART_BYTES = 33_554_432;

/** Parts fetched ahead of the one being sent. */
const READ_AHEAD = 3;

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const { id, recordingId } = await params;

  const rls = await createServerClient();

  // Read through the caller's own client: the policy decides whether they were
  // in this meeting. A recording row they cannot see reads as one that is not
  // there.
  const { data: recording } = await rls
    .from("live_meeting_recordings")
    .select("id, meeting_id, mime_type, status, deleted_at, started_at")
    .eq("id", recordingId)
    .eq("meeting_id", id)
    .maybeSingle();

  const rec = recording as {
    id: string; meeting_id: string; mime_type: string;
    status: string; deleted_at: string | null; started_at: string;
  } | null;

  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (rec.deleted_at) {
    // Said plainly. A recording that has aged out is different from one that
    // never existed, and a viewer following an old link deserves to know which.
    return NextResponse.json(
      { error: "This recording has passed its retention period and was deleted." },
      { status: 410 },
    );
  }

  // Paged: an unpaged read stops at the API's row cap, which cut every
  // recording longer than about 83 minutes off at that point.
  let chunks: RecordingChunk[];
  try {
    chunks = await readAllRecordingParts<RecordingChunk>(rls, recordingId, "path, size");
  } catch (err) {
    console.error("[recording/stream] could not read parts", recordingId, err);
    return NextResponse.json({ error: "Could not read the recording" }, { status: 500 });
  }
  if (!chunks.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const size = totalSize(chunks);
  const download = new URL(req.url).searchParams.get("download") === "1";
  // A player's open-ended "from here on" is answered a window at a time (see
  // PLAYBACK_WINDOW_BYTES). A bounded range is answered exactly as asked, and
  // saving a copy is answered whole, because a download is one request that
  // has to carry the file.
  const rangeHeader = req.headers.get("range");
  const asked = parseRange(rangeHeader, size);
  const range =
    asked && !download && isOpenEndedRange(rangeHeader)
      ? capRange(asked, PLAYBACK_WINDOW_BYTES)
      : asked;
  const wanted = range ?? { start: 0, end: size - 1 };
  const slices = slicesForRange(chunks, wanted);

  // Reads go through the service role once the caller has been cleared above.
  // The bucket's own policy would also allow an attendee, but a signed read per
  // part per seek is a round trip this does not need to make.
  const storage = hasSupabaseServiceEnv()
    ? createServiceClient().storage.from(RECORDING_BUCKET)
    : rls.storage.from(RECORDING_BUCKET);

  // Pull-based, with a short read-ahead. Parts used to be fetched strictly one
  // after another, so a download paid a full storage round trip per five
  // seconds of video — seven hundred of them for an hour — and ran into the
  // function's time limit. Now up to READ_AHEAD parts are in flight while the
  // current one is sent: memory stays bounded at a few parts, however long the
  // meeting was, and the round trips overlap instead of adding up.
  const fetchSlice = async (slice: (typeof slices)[number]) => {
    const { data, error } = await storage.download(slice.path);
    if (error || !data) throw error ?? new Error(`missing part ${slice.path}`);
    const buffer = new Uint8Array(await data.arrayBuffer());
    if (buffer.byteLength > MAX_PART_BYTES) throw new Error("part exceeds the bucket limit");
    return buffer.subarray(slice.start, Math.min(slice.end, buffer.byteLength));
  };
  const inflight: { path: string; bytes: Promise<Uint8Array> }[] = [];
  const fill = () => {
    while (inflight.length < READ_AHEAD && slices.length) {
      const slice = slices.shift()!;
      const bytes = fetchSlice(slice);
      // Observed here so a part that fails after the viewer has gone is not an
      // unhandled rejection; the failure is still thrown where it is awaited.
      bytes.catch(() => {});
      inflight.push({ path: slice.path, bytes });
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      fill();
      const next = inflight.shift();
      if (!next) { controller.close(); return; }
      try {
        controller.enqueue(await next.bytes);
        fill();
      } catch (err) {
        console.error("[recording/stream] part unavailable", next.path, err);
        // Ending the stream mid-file leaves the player with a truncated video
        // rather than a wrong one. There is no way to signal a mid-body failure
        // over HTTP that a <video> element will report usefully.
        inflight.length = 0;
        slices.length = 0;
        controller.close();
      }
    },
    cancel() {
      // The viewer went away: stop queuing parts nobody will read.
      inflight.length = 0;
      slices.length = 0;
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": rec.mime_type || "video/webm",
    "Accept-Ranges": "bytes",
    "Content-Length": String(rangeLength(wanted)),
    // Private and long: the bytes never change, but they are nobody else's.
    "Cache-Control": "private, max-age=3600",
  };

  // Saving a copy. The panel tells a viewer their recording is deleted after
  // ninety days; until this there was nothing they could do about it, which
  // makes the warning worse than no warning.
  //
  // Same rule as watching, deliberately: RLS has already decided this caller
  // was in the meeting, and a recording you may watch in full is one you may
  // keep. The filename carries the meeting date so a folder of them is
  // navigable.
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="${downloadFilename(rec.started_at, rec.mime_type)}"`;
  }

  if (range) headers["Content-Range"] = contentRangeHeader(range, size);

  return new NextResponse(stream as unknown as BodyInit, {
    status: range ? 206 : 200,
    headers,
  });
}

/**
 * A filename a person can find again.
 *
 * Built here rather than taken from the meeting title: a title is user input
 * that ends up in a Content-Disposition header, and quoting it correctly for
 * every browser is a worse problem than not having the title in the name.
 */
function downloadFilename(startedAt: string, mimeType: string): string {
  const at = new Date(startedAt);
  const day = isNaN(at.getTime()) ? "recording" : at.toISOString().slice(0, 10);
  // The same function the stored parts are named by, so a downloaded file and
  // the objects behind it never disagree about what they hold. A one-way call
  // is audio, and saving it as .webm when it is .m4a hands somebody a file
  // their player refuses to open.
  const ext = extensionFor(mimeType || "");
  const what = mimeType.startsWith("audio/") ? "call-recording" : "meeting-recording";
  return `${what}-${day}.${ext}`;
}
