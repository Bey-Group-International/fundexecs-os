import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import { sendEmail } from "@/lib/email";
import { renderMarkdownToHtml } from "@/lib/artifacts/export";
import {
  deliveryOutcome,
  meetingRecipients,
  unreachableNotice,
} from "@/lib/meetings/recipients";
import { SITE_URL } from "@/lib/site";
import {
  UNTITLED_MEETING,
  buildReportMarkdown,
  hasReportSummary,
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
  const loaded = await loadReportForExport(supabase, roomCode, {
    includeTranscript,
    userId: auth.ctx.userId,
    // Canonical, so the recording link in the attached document works from an
    // inbox rather than only from the tab it was generated in.
    origin: SITE_URL,
  });
  if (!loaded) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  // Sending is a stronger act than downloading, and the same rule governs it:
  // somebody who was not in the meeting does not get to mail its summary to
  // its attendees. Checked ahead of "not ready" for the same reason as the
  // export route — to a non-attendee the two are indistinguishable.
  if (!loaded.attended) {
    return NextResponse.json(
      { error: "This report is limited to the people who were in the meeting" },
      { status: 403 },
    );
  }
  // A summary, specifically — not merely a finished report. The download is
  // worth having without one; a message announcing somebody's meeting summary is
  // not. And the two failures are told apart, because "come back in a minute" is
  // the wrong advice for a report whose analysis has already failed: that one
  // needs regenerating and would otherwise never arrive however long they waited.
  if (!hasReportSummary(loaded)) {
    return NextResponse.json(
      {
        error: loaded.hasReport
          ? "There is no summary to send: the analysis did not complete. Regenerate the report from the meeting log and try again."
          : "Report not ready",
      },
      { status: 409 },
    );
  }

  // The invitation AND the room. Addressing only the invitation meant an instant
  // meeting — created with an empty attendee list, and the commonest kind there
  // is — could never email its own summary to the people who were in it.
  const audience = meetingRecipients({
    invited: loaded.attendees,
    present: loaded.present,
    senderEmail: auth.ctx.email,
  });
  const recipients = audience.recipients;
  if (recipients.length === 0) {
    // Which of the two things has happened, because the answer to each is
    // different: invite somebody, or send it yourself to the people you know.
    const notice = unreachableNotice(audience.unreachable);
    return NextResponse.json(
      {
        error: notice
          ? `There is nobody to send this to. ${notice}`
          : "This meeting has no attendees with email addresses.",
        unreachable: audience.unreachable,
      },
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
  // everybody else who was invited or in the room.
  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      sendEmail({
        orgId: auth.ctx.orgId,
        credentials: { gmailAccessToken: mailbox.token },
        // The person's own name. This path built one out of the address —
        // "Summary: Q3 review" arriving addressed to "j.smith" — while the
        // follow-up, sending the same meeting to the same people, used the real
        // one. Two paths through one meeting's data disagreed about what to call
        // the people in it.
        to: { name: recipient.name, email: recipient.email },
        subject: `Summary: ${title}`,
        htmlBody: html,
      }),
    ),
  );

  const { sent, failed } = deliveryOutcome(recipients, results);

  return NextResponse.json({
    sent,
    total: recipients.length,
    // Who was in the room and has no address here, so the caller can stop
    // reporting a send of two as complete in a meeting of four.
    unreachable: audience.unreachable,
    failed,
  });
}
