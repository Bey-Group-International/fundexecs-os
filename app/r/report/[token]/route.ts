// GET /r/report/[token] — a meeting summary, read-only, for the invitee it was emailed to.
//
// Outside the (app) layout on purpose: no account and no login. The token is the
// authorization (lib/meetings/report-share.server.ts): it names the meeting and
// the recipient and expires. What it opens is the summary document the email
// carried — summary, decisions, action items — never the transcript, chat or
// recording, which stay behind the meeting's own access rules.
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { verifyReportShare } from "@/lib/meetings/report-share.server";
import { loadReportForExport } from "@/lib/meetings/report-export.server";
import { UNTITLED_MEETING, buildReportMarkdown, hasReportSummary } from "@/lib/meetings/report-export";
import { renderMarkdownToHtml } from "@/lib/artifacts/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function page(status: number, title: string, message: string): Response {
  const html = renderMarkdownToHtml(`# ${title}\n\n${message}\n`, title);
  return new Response(html, { status, headers: HEADERS });
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = verifyReportShare(decodeURIComponent(token));
  if (!share) {
    return page(404, "Link expired", "This link to a meeting summary has expired or is not valid. Ask the person who sent it for a new one.");
  }
  if (!hasSupabaseServiceEnv()) return page(503, "Unavailable", "This summary cannot be shown right now.");

  const supabase = createServiceClient();
  const { data: live } = await supabase
    .from("live_meetings")
    .select("deleted_at")
    .eq("room_code", share.r)
    .maybeSingle();
  if (!live || (live as { deleted_at?: string | null }).deleted_at) {
    return page(404, "Not available", "This meeting summary is no longer available.");
  }

  // No userId: the attendance-gated blocks (recording, chat, room list) stay empty.
  const loaded = await loadReportForExport(supabase as never, share.r, { includeTranscript: false, userId: null });
  if (!loaded || !hasReportSummary(loaded)) {
    return page(404, "Not available", "This meeting summary is no longer available.");
  }

  const title = (loaded.title ?? "").trim() || UNTITLED_MEETING;
  return new Response(renderMarkdownToHtml(buildReportMarkdown(loaded, { includeTranscript: false }), title), {
    status: 200,
    headers: HEADERS,
  });
}
