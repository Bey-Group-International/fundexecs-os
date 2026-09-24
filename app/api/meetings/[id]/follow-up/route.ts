// app/api/meetings/[id]/follow-up/route.ts
// Sending the follow-up email a meeting's report already wrote.
//
// The report asks the model for a ready-to-send email and gets one. Until this
// route, the only thing the product could do with it was put it on the
// clipboard — so the host opened another application, pasted it, and typed in
// the addresses of people this meeting already knows.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { logId } from "@/lib/log-safe";
import { createServerClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import { normalizeNoteText } from "@/lib/meetings/live-notes";
import {
  deliveryOutcome,
  everyoneReached,
  meetingRecipients,
  unreachableNotice,
} from "@/lib/meetings/recipients";
import { loadPresentPeople } from "@/lib/meetings/recipients.server";
import {
  followUpBody,
  followUpHtml,
  followUpSubject,
} from "@/lib/meetings/follow-up";

export const runtime = "nodejs";

interface FollowUpRequest {
  /**
   * The draft as the host has it on screen.
   *
   * Accepted because the page lets them edit it before sending, which is the
   * difference between a draft and a letter. Omitted, the stored one is sent.
   */
  body?: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = await createServerClient();

  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, title, host_id, organization_id, attendees")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  // The follow-up goes out over the host's name and reaches everyone who was
  // in the room. That is the host's to send.
  if (meeting.host_id !== auth.ctx.userId) {
    return NextResponse.json({ error: "Only the meeting host can send the follow-up." }, { status: 403 });
  }

  const payload = (await req.json().catch(() => ({}))) as FollowUpRequest;

  // The host's edit wins; the stored draft is the fallback. Read the newest
  // report, the same ordering the report page and the log use, so a
  // regenerated follow-up is the one that gets sent.
  let draft = followUpBody(typeof payload.body === "string" ? payload.body : "");
  if (!draft) {
    const { data: report } = await supabase
      .from("live_meeting_reports")
      .select("analysis")
      .eq("meeting_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const analysis = (report?.analysis ?? null) as Record<string, unknown> | null;
    draft = followUpBody(normalizeNoteText(analysis?.follow_up_draft));
  }

  if (!draft) {
    return NextResponse.json(
      { error: "There is no follow-up to send for this meeting yet." },
      { status: 409 },
    );
  }

  // The invitation AND the room. This walked only `attendees`, the list somebody
  // typed before the meeting — which is empty for every instant meeting, so the
  // commonest kind of meeting in the product answered 409 "Nobody on this
  // meeting has an email address to send to." while the attendance table held a
  // row for every person who had been in it.
  const audience = meetingRecipients({
    invited: meeting.attendees,
    present: await loadPresentPeople(supabase, id),
    senderEmail: auth.ctx.email,
  });
  const recipients = audience.recipients;
  if (recipients.length === 0) {
    // Said plainly rather than answering "sent 0", which reads as a failure of
    // the mailbox rather than as a meeting whose attendees have no addresses —
    // and naming the people who were there, because the host is the only one who
    // can reach them and cannot if nobody says who they are.
    const notice = unreachableNotice(audience.unreachable);
    return NextResponse.json(
      {
        error: notice
          ? `There is nobody to send this to. ${notice}`
          : "Nobody on this meeting has an email address to send to.",
        unreachable: audience.unreachable,
      },
      { status: 409 },
    );
  }

  const mailbox = await mailboxFor(supabase, auth.ctx.userId, auth.ctx.orgId);
  if (!mailbox.ok) {
    return NextResponse.json(
      { error: mailboxProblemMessage(mailbox.problem), mailboxConnected: false },
      { status: 409 },
    );
  }

  const subject = followUpSubject(meeting.title);
  const htmlBody = followUpHtml(draft);

  // Per recipient, and settled: one bad address must not stop the rest of the
  // room hearing from the meeting they were in.
  const results = await Promise.allSettled(
    recipients.map((r) =>
      sendEmail({
        orgId: auth.ctx.orgId,
        credentials: { gmailAccessToken: mailbox.token },
        to: { name: r.name, email: r.email },
        subject,
        htmlBody,
      }),
    ),
  );

  const { sent, failed } = deliveryOutcome(recipients, results);
  // Whether the meeting can honestly be called followed up: everybody who was
  // in it heard from the host. Computed once, and used for both the badge and
  // what the panel says, so the two cannot disagree.
  const complete = everyoneReached(audience, sent);
  if (sent === 0) {
    console.error("[/api/meetings/:id/follow-up] every send failed", { meetingId: logId(id) });
    return NextResponse.json(
      {
        error: "The follow-up could not be sent. Check the connected mailbox and try again.",
        sent,
        total: recipients.length,
        failed,
      },
      { status: 502 },
    );
  }

  // The meetings list reads followup_status and shows "Follow-Up Needed" off
  // it. Nothing has ever written "done" — every report with a follow-up draft
  // set it to "draft" and left it there, so a meeting carried that badge for
  // the rest of its life however diligently the host actually followed up.
  //
  // Only when everyone was reached. A partial send is still outstanding for
  // whoever did not get it, and quietly closing it would hide exactly the
  // meetings that still need a person.
  //
  // "Everyone" has to mean everyone who was in the meeting, not every address
  // the send happened to have. Bounded by the addresses, this closed out a
  // meeting whose three guests were never written to at all — the bound has to
  // be derived from what it bounds, and what it bounds is the room.
  if (complete) {
    const { error: statusError } = await supabase
      .from("live_meetings")
      .update({ followup_status: "done" } as never)
      .eq("id", id);
    if (statusError) {
      // Not worth failing the response over: the email went. But the badge is
      // now wrong, and nothing else would ever say so.
      console.error(
        "[/api/meetings/:id/follow-up] status not marked done",
        { meetingId: logId(id) },
        statusError.message,
      );
    }
  }

  return NextResponse.json({
    sent,
    total: recipients.length,
    // Who was in the room and has no address here.
    unreachable: audience.unreachable,
    failed,
    mailboxConnected: true,
    followUpComplete: complete,
  });
}
