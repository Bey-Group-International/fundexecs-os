// app/api/meetings/[id]/follow-up/route.ts
// Sending the follow-up email a meeting's report already wrote.
//
// The report asks the model for a ready-to-send email and gets one. Until this
// route, the only thing the product could do with it was put it on the
// clipboard — so the host opened another application, pasted it, and typed in
// the addresses of people this meeting already knows.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import { normalizeNoteText } from "@/lib/meetings/live-notes";
import type { MeetingAttendeeInput } from "@/lib/meetings/attendees";
import {
  followUpBody,
  followUpHtml,
  followUpRecipients,
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

  const attendees = (Array.isArray(meeting.attendees) ? meeting.attendees : []) as MeetingAttendeeInput[];
  const recipients = followUpRecipients(attendees, auth.ctx.email);
  if (recipients.length === 0) {
    // Said plainly rather than answering "sent 0", which reads as a failure of
    // the mailbox rather than as a meeting whose attendees have no addresses.
    return NextResponse.json(
      { error: "Nobody on this meeting has an email address to send to." },
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

  const sent = results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
  if (sent === 0) {
    console.error(`[/api/meetings/${id}/follow-up] every send failed`);
    return NextResponse.json(
      { error: "The follow-up could not be sent. Check the connected mailbox and try again.", sent, total: recipients.length },
      { status: 502 },
    );
  }

  return NextResponse.json({ sent, total: recipients.length, mailboxConnected: true });
}
