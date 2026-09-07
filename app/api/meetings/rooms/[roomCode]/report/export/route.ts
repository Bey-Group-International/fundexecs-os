import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import {
  EXPORT_CONTENT_TYPES,
  exportExtension,
  isBinaryFormat,
  isExportFormat,
  renderArtifact,
} from "@/lib/artifacts/export";
import { renderArtifactBinary } from "@/lib/artifacts/export-binary";
import {
  buildReportMarkdown,
  hasExportableReport,
  reportExportFilename,
} from "@/lib/meetings/report-export";
import { loadReportForExport } from "@/lib/meetings/report-export.server";

// GET /api/meetings/rooms/[roomCode]/report/export?format=pdf|docx|md|html|rtf&transcript=1
//
// The meeting report as a downloadable document. Reuses the artifact
// exporters: the report is rendered to markdown, and those already turn
// markdown into all five formats.
//
// Read through the user's own session client rather than the service client,
// so a report is exportable exactly when it is readable — the same RLS the
// report page is already subject to, rather than a second access rule that
// could drift away from it.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  const { roomCode } = await params;

  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const format = new URL(request.url).searchParams.get("format") ?? "pdf";
  if (!isExportFormat(format)) {
    return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
  }
  const includeTranscript = new URL(request.url).searchParams.get("transcript") === "1";

  const supabase = await createServerClient();
  const loaded = await loadReportForExport(supabase, roomCode);
  if (!loaded) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  // Still generating. 409 rather than 404: the meeting is real and the answer
  // will change on its own, which is a different thing to tell a caller.
  if (!hasExportableReport(loaded)) {
    return NextResponse.json({ error: "Report not ready" }, { status: 409 });
  }

  const markdown = buildReportMarkdown(loaded, { includeTranscript });
  const title = loaded.title ?? undefined;
  const filename = reportExportFilename(
    loaded.title, loaded.createdAt, exportExtension(format), { includeTranscript },
  );

  const headers = {
    "Content-Type": EXPORT_CONTENT_TYPES[format],
    "Content-Disposition": `attachment; filename="${filename}"`,
    // A report can be regenerated, and a stale cached copy of somebody's
    // meeting notes is worse than a second render.
    "Cache-Control": "no-store",
  };

  if (isBinaryFormat(format)) {
    const bytes = await renderArtifactBinary(format, markdown, title);
    // Hand the exact byte range over as an ArrayBuffer so the backing store
    // can never leak trailing bytes into the download.
    const buffer = bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(buffer, { status: 200, headers });
  }

  return new NextResponse(renderArtifact(format, markdown, title), { status: 200, headers });
}
