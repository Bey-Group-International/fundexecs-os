// GET /r/report/[token] — a meeting summary, read-only, for somebody with no account.
//
// Outside the (app) layout on purpose: no account and no login. The token is the
// authorization (lib/meetings/report-share.server.ts): it names the meeting and
// either the recipient it was emailed to or the guest it was minted for, and
// it expires. What it opens is the summary document the email carried —
// summary, decisions, action items — never the transcript, chat or recording,
// which stay behind the meeting's own access rules.
//
// A link can arrive before its report does. An emailed one never did — the
// email is only sent once there is a summary — but a guest is handed theirs on
// the way out of the room, in the seconds before the host's End has finished
// writing, or for a meeting the host has not ended at all. A page that said
// "not available" to that guest would be the product telling them the meeting
// they just left had no record. So the page tells the truth about where the
// report is: still being written (and reloads itself to look again), filed
// with nothing to summarise, or not written at all.
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { verifyReportShare } from "@/lib/meetings/report-share.server";
import { loadReportForExport } from "@/lib/meetings/report-export.server";
import { UNTITLED_MEETING, buildReportMarkdown, hasReportSummary } from "@/lib/meetings/report-export";
import { renderMarkdownToHtml } from "@/lib/artifacts/export";
import { reportStillPending, type ReportMeeting } from "@/lib/meetings/report-page";
import { NOTHING_TO_SUMMARISE, unsummarisedReason } from "@/lib/meetings/report-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How often a holding page looks again. The in-app poll asks every 5s; a guest can wait longer. */
export const NOT_READY_REFRESH_SECONDS = 15;

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function page(status: number, title: string, message: string, opts: { refreshSeconds?: number } = {}): Response {
  let html = renderMarkdownToHtml(`# ${title}\n\n${message}\n`, title);
  // A meta refresh rather than a script: the CSP above allows no script, and
  // a holding page that cannot look again is a holding page forever.
  if (opts.refreshSeconds) {
    html = html.replace("</head>", `<meta http-equiv="refresh" content="${opts.refreshSeconds}">\n</head>`);
  }
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
    .select("id, deleted_at, host_id, title, created_at, started_at, ended_at, scheduled_at, kind")
    .eq("room_code", share.r)
    .maybeSingle();
  const meeting = live as (ReportMeeting & { deleted_at?: string | null }) | null;
  if (!meeting || meeting.deleted_at) {
    return page(404, "Not available", "This meeting summary is no longer available.");
  }

  // No userId: the attendance-gated blocks (recording, chat, room list) stay empty.
  const loaded = await loadReportForExport(supabase as never, share.r, { includeTranscript: false, userId: null });
  if (!loaded) return page(404, "Not available", "This meeting summary is no longer available.");

  const title = (loaded.title ?? "").trim() || UNTITLED_MEETING;

  if (hasReportSummary(loaded)) {
    return new Response(renderMarkdownToHtml(buildReportMarkdown(loaded, { includeTranscript: false }), title), {
      status: 200,
      headers: HEADERS,
    });
  }

  // A report row with no summary is FINISHED: filed without a model call
  // because nothing usable was heard, or the analysis failed. Neither is
  // coming, so neither page reloads.
  if (loaded.hasReport) {
    return unsummarisedReason(loaded.analysis)
      ? page(200, title, NOTHING_TO_SUMMARISE)
      : page(200, title, "No summary was written for this meeting. The host can regenerate the report; this link will show it once they have.");
  }

  // No report row at all. Within the window the room's own report page waits,
  // this one waits too and looks again; past it, it says so and stops.
  if (reportStillPending(meeting, Date.now())) {
    return page(
      200,
      title,
      "The summary of this meeting is still being written. This page will check again in a moment.",
      { refreshSeconds: NOT_READY_REFRESH_SECONDS },
    );
  }
  return page(
    200,
    title,
    "The summary of this meeting has not been written yet. Check back later, or ask the host to generate it.",
  );
}
