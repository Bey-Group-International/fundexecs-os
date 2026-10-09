import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { logId } from "@/lib/log-safe";
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
import { reportShareUrl } from "@/lib/meetings/report-share.server";
import { recordFollowUpThreads } from "@/lib/meetings/follow-up-threads.server";
import { summaryAlreadySent } from "@/lib/meetings/report-generation";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

// POST /api/meetings/rooms/[roomCode]/report/email  { includeTranscript?: boolean, resend?: boolean }
//
// Send the meeting summary to the people who were in the meeting, from the
// host's connected mailbox. The body is the same document the HTML export
// produces, so what lands in an inbox and what downloads to a disk cannot
// diverge.
//
// Three rules, each the answer to something that went wrong:
//
//   HOST ONLY. Any attendee could mail the summary of the host's meeting to
//   everyone in it, from their own mailbox, over the host's record. Sending is
//   the host's act, as the follow-up already was.
//
//   THE ROOM, NOT THE INVITATION. The invite list names people who may never
//   have joined, and a summary of a meeting you were not in — "here is what we
//   decided" — is the wrong first thing to hear about it. The attendance rows
//   are who was there.
//
//   ONCE. The button had no memory: a second press mailed everyone again and
//   doubled the inbox threads. The meeting row now records the first send, and
//   a second press is told when it went unless it says `resend`.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  const { roomCode } = await params;

  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let includeTranscript = false;
  let resend = false;
  try {
    const body = await request.json();
    includeTranscript = body?.includeTranscript === true;
    resend = body?.resend === true;
  } catch {
    // No body is a valid request: summary only, once.
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
  // Checked ahead of "not ready" for the same reason as the export route: to
  // somebody who may not send it, the two are indistinguishable, and 409 would
  // invite them to keep trying.
  if (loaded.hostId !== auth.ctx.userId) {
    return NextResponse.json(
      { error: "Only the meeting host can email the summary." },
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

  if (summaryAlreadySent({ sentAt: loaded.summarySentAt, resend })) {
    return NextResponse.json({
      alreadySent: true,
      sentAt: loaded.summarySentAt,
      sent: 0,
      total: 0,
      unreachable: [],
      failed: [],
    });
  }

  // The room and only the room. `loaded.present` is the attendance table with
  // addresses filled in from the directory where there are any; invitees who
  // never joined are not in it and are not written to.
  const audience = meetingRecipients({
    present: loaded.present,
    senderEmail: auth.ctx.email,
  });
  const recipients = audience.recipients;
  if (recipients.length === 0) {
    // Which of the two things has happened, because the answer to each is
    // different: somebody was there without an address, or nobody was there.
    const notice = unreachableNotice(audience.unreachable);
    return NextResponse.json(
      {
        error: notice
          ? `There is nobody to send this to. ${notice}`
          : "Nobody who was in this meeting has an email address here.",
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
  const subject = `Summary: ${title}`;
  const document = buildReportMarkdown(loaded, { includeTranscript });
  // The in-app report opens only for signed-in members who were in the meeting.
  // Each recipient's copy links to a private, expiring read-only summary of
  // their own instead (lib/meetings/report-share.server.ts), so an external
  // invitee is not met by a login wall. The in-app link is the fallback where
  // links cannot be signed.
  const appUrl = `${SITE_URL.replace(/\/$/, "")}/meetings/${loaded.roomCode}/report`;
  const markdownFor = (email: string) =>
    document + `\n---\n\n[View the full report](${reportShareUrl(loaded.roomCode, email) ?? appUrl})\n`;
  const bodies = recipients.map((r) => markdownFor(r.email));

  // Settled, not raced: one bad address must not withhold the summary from
  // everybody else who was in the room.
  const results = await Promise.allSettled(
    recipients.map((recipient, i) =>
      sendEmail({
        orgId: auth.ctx.orgId,
        credentials: { gmailAccessToken: mailbox.token },
        // The person's own name. This path built one out of the address —
        // "Summary: Q3 review" arriving addressed to "j.smith" — while the
        // follow-up, sending the same meeting to the same people, used the real
        // one. Two paths through one meeting's data disagreed about what to call
        // the people in it.
        to: { name: recipient.name, email: recipient.email },
        subject,
        htmlBody: renderMarkdownToHtml(bodies[i], title),
      }),
    ),
  );

  const { sent, failed } = deliveryOutcome(recipients, results);

  // Each delivered copy is an inbox thread with that person, linked to this
  // meeting — so their reply lands beside it, counts as a reply on the meeting,
  // and (from the sender's own mailbox) is read back. Service role, as for the
  // follow-up: the ingest ledger and tracking table are not member-writable.
  // Never throws.
  //
  // Under the MEETING's organisation, not the caller's. A host whose active
  // organisation was switched to another of theirs filed the threads — and
  // the replies that followed — in the wrong organisation's inbox, beside a
  // meeting that organisation cannot see.
  if (hasSupabaseServiceEnv()) {
    await recordFollowUpThreads(createServiceClient(), {
      orgId: loaded.organizationId ?? auth.ctx.orgId,
      meetingId: loaded.meetingId,
      hostId: auth.ctx.userId,
      hostName: null,
      subject,
      kind: "summary",
      mailbox: { source: mailbox.source, email: mailbox.email },
      sends: recipients.map((recipient, i) => ({ recipient, body: bodies[i], result: results[i] })),
    });
  }

  // Remembered once anybody was reached, so the next press is a question
  // rather than a repeat. A send that reached nobody leaves it unset: there
  // is nothing to repeat, and the host should be able to try again.
  if (sent > 0) {
    const { error } = await supabase
      .from("live_meetings")
      .update({ summary_sent_at: new Date().toISOString() } as never)
      .eq("id", loaded.meetingId);
    if (error) {
      // Not worth failing the response over: the mail went. But the guard is
      // now missing for this meeting, and nothing else would ever say so.
      console.error(
        "[/api/meetings/rooms/:roomCode/report/email] send not recorded",
        { meetingId: logId(loaded.meetingId) },
        error.message,
      );
    }
  }

  return NextResponse.json({
    sent,
    total: recipients.length,
    // Who was in the room and has no address here, so the caller can stop
    // reporting a send of two as complete in a meeting of four.
    unreachable: audience.unreachable,
    failed,
  });
}
