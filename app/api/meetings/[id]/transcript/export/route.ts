// Downloading a meeting's transcript: plain text, Markdown, SRT or WebVTT
// captions, or a Word document — with speaker names and corrections applied.
//
// Read through the caller's own client, so the transcript's own policy decides
// who may have it: the people who were in the meeting.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import {
  EXPORT_TYPES,
  applyOverlay,
  exportFileName,
  exportLines,
  isExportFormat,
  toMarkdown,
  toSrt,
  toText,
  toVtt,
} from "@/lib/meetings/transcript-tools";
import { loadOverlay, loadTranscriptRows, transcriptDocx } from "@/lib/meetings/transcript-tools.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 30;

type Params = Promise<{ id: string }>;

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const limit = checkRateLimit({ key: `transcript-export:${clientIp(req)}`, limit: LIMIT, windowMs: 60_000 });
  if (!limit.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimitHeaders(limit, LIMIT) });
  const { id } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "txt";
  if (!isExportFormat(format)) return NextResponse.json({ error: "Unknown format" }, { status: 400 });
  const timestamps = url.searchParams.get("timestamps") !== "0";

  const supabase = await createServerClient();
  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, title, started_at, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const m = meeting as { id: string; title: string | null; started_at: string | null; created_at: string } | null;
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = supabase as unknown as { from: (t: string) => any };
  let rows;
  try {
    rows = await loadTranscriptRows(db, id);
  } catch {
    return NextResponse.json({ error: "Could not read the transcript" }, { status: 500 });
  }
  // Rows the caller may not read come back empty under RLS: the same answer as none.
  if (!rows.length) return NextResponse.json({ error: "There's no transcript to download." }, { status: 404 });

  const shown = applyOverlay(rows, await loadOverlay(db, id));
  const origin = Date.parse(m.started_at ?? "");
  const lines = exportLines(shown, Number.isFinite(origin) ? origin : null);
  const title = m.title?.trim() || "Meeting transcript";

  let body: string | Uint8Array;
  if (format === "docx") body = await transcriptDocx(lines, { title, timestamps });
  else if (format === "md") body = toMarkdown(lines, { title, timestamps });
  else if (format === "srt") body = toSrt(lines);
  else if (format === "vtt") body = toVtt(lines);
  else body = toText(lines, { title, timestamps });

  const at = new Date(m.started_at ?? m.created_at);
  return new NextResponse(body as BodyInit, {
    headers: {
      "Content-Type": EXPORT_TYPES[format],
      "Content-Disposition": `attachment; filename="${exportFileName(at, format)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
