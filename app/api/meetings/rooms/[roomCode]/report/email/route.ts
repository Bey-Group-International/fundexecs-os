import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import { sendEmail } from "@/lib/email";
import { renderMarkdownToHtml } from "@/lib/artifacts/export";
import { normalizeAttendees } from "@/lib/meetings/attendees";
import { guestEmails } from "@/lib/meetings/invite";
import { SITE_URL } from "@/lib/site";
import {
  UNTITLED_MEETING,
  buildReportMarkdown,
  hasExportableReport,
} from "@/lib/meetings/report-export";
import { loadReportForExport } from "@/lib/meetings/report-export.server";

// POST /api/meetings/rooms/[roomCode]/report/email  { includeTranscript?: boolean }
//
// Send the meeting summary to the meeting's attendees, from the org's
// connected mailbox. The body is the same document the HTML export produces,
// so what lands in an inbox and what downloads to a disk cannot diverge.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  const { roomCode } = await params;

  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let includeTranscript = false;
  try {
    const body = await request.json();
    includeTranscript = body?.includeTranscript === true;
  } catch {
    // No body is a valid request: summary only.
  }

  const supabase = await createServerClient();
  const loaded = await loadReportForExport(supabase, roomCode, { includeTranscript });
  if (!loaded) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (!hasExportableReport(loaded)) {
    return NextResponse.json({ error: "Report not ready" }, { status: 409 });
  }

  const recipients = guestEmails(normalizeAttendees(loaded.attendees));
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "This meeting has no attendees with email addresses." },
      { status: 400 },
    );
  }

  const mailbox = await mailboxFor(supabase, auth.ctx.userId, auth.ctx.orgId);
  if (!mailbox.ok) {
    return NextResponse.json({ error: mailboxProblemMessage(mailbox.problem) }, { status: 400 });
  }

  const title = (loaded.title ?? "").trim() || UNTITLED_MEETING;
  // The link is appended for the email only. A downloaded file is a copy
  // somebody keeps; a message is something they act on, and the report is
  // where the transcript and any later regeneration live.
  const reportUrl = `${SITE_URL.replace(/\/$/, "")}/meetings/${loaded.roomCode}/report`;
  const markdown =
    buildReportMarkdown(loaded, { includeTranscript }) +
    `\n---\n\n[View the full report](${reportUrl})\n`;

  const html = renderMarkdownToHtml(markdown, title);

  // Settled, not raced: one bad address must not withhold the summary from
  // everybody else on the invitation.
  const results = await Promise.allSettled(
    recipients.map((email) =>
      sendEmail({
        orgId: auth.ctx.orgId,
        credentials: { gmailAccessToken: mailbox.token },
        to: { name: email.split("@")[0] ?? email, email },
        subject: `Summary: ${title}`,
        htmlBody: html,
      }),
    ),
  );

  const sent = results.filter(
    (r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok,
  ).length;

  return NextResponse.json({ sent, total: recipients.length });
}
