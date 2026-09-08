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
  rendererDrawsTitle,
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

  const query = new URL(request.url).searchParams;
  const format = query.get("format") ?? "pdf";
  if (!isExportFormat(format)) {
    return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
  }
  const includeTranscript = query.get("transcript") === "1";

  const supabase = await createServerClient();
  // Told up front, so a summary-only export never reads the transcript it is
  // about to discard — on an hour-long meeting that is tens of kilobytes.
  const loaded = await loadReportForExport(supabase, roomCode, {
    includeTranscript,
    userId: ctx.userId,
  });
  if (!loaded) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  // Checked before "not ready", because to a non-attendee they look identical:
  // RLS empties the report fields, and 409 would tell somebody who will never
  // be allowed to download this to come back and try again.
  if (!loaded.attended) {
    return NextResponse.json(
      { error: "This report is limited to the people who were in the meeting" },
      { status: 403 },
    );
  }

  // Still generating. 409 rather than 404: the meeting is real and the answer
  // will change on its own, which is a different thing to tell a caller.
  if (!hasExportableReport(loaded)) {
    return NextResponse.json({ error: "Report not ready" }, { status: 409 });
  }

  // RTF, DOCX and PDF draw the title they are handed; HTML and markdown do
  // not. Emitting the heading for the first three would print the name twice.
  const markdown = buildReportMarkdown(loaded, {
    includeTranscript,
    titleHeading: !rendererDrawsTitle(format),
  });
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
