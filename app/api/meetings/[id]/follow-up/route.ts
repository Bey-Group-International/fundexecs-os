// app/api/meetings/[id]/follow-up/route.ts
// Sending the follow-up email a meeting's report already wrote.
//
// The report asks the model for a ready-to-send email and gets one. Until this
// route, the only thing the product could do with it was put it on the
// clipboard — so the host opened another application, pasted it, and typed in
// the addresses of people this meeting already knows.
import { isPlatformAdmin } from "@/lib/platform-admin";
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { logId } from "@/lib/log-safe";
import { createServerClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { cleanNudgeDays, cleanSendAt, itemsFor, withPersonalItems } from "@/lib/meetings/follow-up-loop";
import { recordSends } from "@/lib/meetings/follow-up-sends.server";
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
import { personalizeFollowUp } from "@/lib/meetings/follow-up-greeting";
import { loadHost } from "@/lib/meetings/report-roles.server";
import { recordFollowUpThreads } from "@/lib/meetings/follow-up-threads.server";
import { ensureMeetingThread } from "@/lib/meetings/meeting-thread.server";
import { gateDecision } from "@/lib/gates";
import { getActiveMandate } from "@/lib/mandates";
import { replyToThread } from "@/app/(app)/inbox/actions";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface FollowUpRequest {
  /**
   * The draft as the host has it on screen.
   *
   * Accepted because the page lets them edit it before sending, which is the
   * difference between a draft and a letter. Omitted, the stored one is sent.
   */
  body?: string;
  /** Later, as an ISO time: scheduled rather than sent. Omitted, now. */
  sendAt?: string | null;
  /** Nudge anyone who has not replied after this many days (2, 3, 5 or 7). */
  nudgeAfterDays?: number | null;
  /** Only these addresses — a retry to the people a send failed for. */
  only?: string[];
  /** Give each reader their own next steps (default true). */
  personalItems?: boolean;
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

  // The draft, the people who were there and the mailbox to send from are
  // three independent lookups — the last one a Google token exchange when the
  // grant has aged out — and they ran one after another while the host watched
  // the Send button spin. They start together now. The mailbox is only
  // AWAITED after the checks below, so a meeting with no draft or nobody to
  // send to still answers exactly what it did; the caught copy only keeps an
  // early return from leaving its rejection unhandled.
  const mailboxLookup = mailboxFor(supabase, auth.ctx.userId, auth.ctx.orgId);
  mailboxLookup.catch(() => {});

  // The host's edit wins; the stored draft is the fallback. Read the newest
  // report, the same ordering the report page and the log use, so a
  // regenerated follow-up is the one that gets sent.
  const edited = followUpBody(typeof payload.body === "string" ? payload.body : "");
  const sendAt = cleanSendAt(payload.sendAt, Date.now());
  if (sendAt === undefined) {
    return NextResponse.json(
      { error: "Pick a time between a few minutes and 30 days from now." },
      { status: 422 },
    );
  }
  const nudgeAfterDays = cleanNudgeDays(payload.nudgeAfterDays);
  const only = Array.isArray(payload.only)
    ? new Set(payload.only.filter((e): e is string => typeof e === "string").map((e) => e.trim().toLowerCase()))
    : null;
  const reportRead = supabase
    .from("live_meeting_reports")
    .select("analysis")
    .eq("meeting_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(({ data: report }) => (report?.analysis ?? null) as Record<string, unknown> | null);
  const [analysis, present, host] = await Promise.all([
    reportRead,
    loadPresentPeople(supabase, id),
    // Only to recognise a greeting that names the host; see personalizeFollowUp.
    loadHost(supabase, auth.ctx.userId),
  ]);

  const draft = edited || followUpBody(normalizeNoteText(analysis?.follow_up_draft));
  // Each reader's own next steps, from the report's action items.
  const actionItems = payload.personalItems === false ? [] : normalizeNoteList(analysis?.action_items, 30);

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
    present,
    senderEmail: auth.ctx.email,
  });
  const recipients = only ? audience.recipients.filter((r) => only.has(r.email.toLowerCase())) : audience.recipients;
  if (recipients.length === 0 && only) {
    return NextResponse.json({ error: "None of those people are on this meeting." }, { status: 409 });
  }
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

  const subject = followUpSubject(meeting.title);
  const hostName = host?.full_name ?? null;
  /** What one reader gets: their name in the greeting and their own next steps. */
  const bodyFor = (r: { name: string; email: string }) =>
    withPersonalItems(personalizeFollowUp(draft, r.name, { hostName }), itemsFor(r, actionItems, audience.recipients));

  // Before the gate as well as the send: a follow-up held for approval with no
  // mailbox to send it from would be approved into nothing.
  const mailbox = await mailboxLookup;
  if (!mailbox.ok) {
    return NextResponse.json(
      { error: mailboxProblemMessage(mailbox.problem), mailboxConnected: false },
      { status: 409 },
    );
  }

  // The same gate every inbox reply passes. An organisation whose mandate does
  // not pre-authorise outbound replies gets the follow-up in approvals — one
  // per attendee, each on that attendee's thread for this meeting — instead of
  // an immediate send; nothing reaches anybody until it is approved.
  const mandate = await getActiveMandate(supabase, auth.ctx.orgId);
  const gated = gateDecision("send_reply", mandate, undefined, { platformAdmin: isPlatformAdmin(auth.ctx) }).requiresApproval;

  // Later: one scheduled row per recipient, sent by the hourly sweep from the
  // host's mailbox. Not for a firm whose sends wait on approval — a scheduled
  // send would either skip the gate or sit in it past its time.
  if (sendAt) {
    if (gated) {
      return NextResponse.json(
        { error: "Your firm approves outbound email first, so a follow-up can't be scheduled. Draft it in the inbox instead." },
        { status: 409 },
      );
    }
    if (!hasSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Scheduling isn't available here." }, { status: 503 });
    }
    const scheduled = await recordSends(createServiceClient(), {
      meetingId: id,
      orgId: auth.ctx.orgId,
      createdBy: auth.ctx.userId,
      subject,
      sends: recipients.map((r) => ({
        email: r.email,
        name: r.name,
        body: bodyFor(r),
        status: "scheduled" as const,
        scheduledFor: sendAt.toISOString(),
        nudgeAfterDays,
      })),
    });
    if (!scheduled) {
      return NextResponse.json(
        { error: "Scheduling isn't available yet — send now, or try again in a few minutes." },
        { status: 503 },
      );
    }
    return NextResponse.json({ scheduled, at: sendAt.toISOString(), total: recipients.length, unreachable: audience.unreachable });
  }

  if (gated) {
    let queued = 0;
    // Known contacts the firm has written to before skip the hold and go now
    // (lib/inbox/known-contact.server.ts), so a gated follow-up can be both.
    let sentNow = 0;
    const failed: string[] = [];
    for (const r of recipients) {
      const personal = bodyFor(r);
      const thread = await ensureMeetingThread(supabase, {
        orgId: auth.ctx.orgId,
        actorId: auth.ctx.userId,
        meetingId: id,
        recipient: r,
        subject,
        preview: personal,
      });
      if (!thread.ok) {
        failed.push(r.email);
        continue;
      }
      const fd = new FormData();
      fd.set("thread_id", thread.threadId);
      fd.set("body", personal);
      const result = await replyToThread(fd);
      if (!result.ok) failed.push(r.email);
      else if (result.gated) queued++;
      else sentNow++;
    }
    if (queued === 0 && sentNow === 0) {
      return NextResponse.json(
        { error: "The follow-up could not be queued for approval.", failed, total: recipients.length },
        { status: 502 },
      );
    }
    // The page's chip reads followup_status, and this branch never wrote it:
    // a follow-up sitting in approvals showed as "Not sent" — the same word
    // as a follow-up nobody had pressed Send on — so the host pressed it
    // again and queued every attendee's copy twice. The database's own sync
    // (live_meeting_sync_followup) moves it on from here as the approvals are
    // decided; this is the step it cannot take, because the approval rows it
    // reads are written by the inbox action above and it is not told when.
    const { error: pendingError } = queued > 0
      ? await supabase
          .from("live_meetings")
          .update({ followup_status: "pending_approval" } as never)
          .eq("id", id)
      : { error: null };
    if (pendingError) {
      console.error(
        "[/api/meetings/:id/follow-up] status not marked pending_approval",
        { meetingId: logId(id) },
        pendingError.message,
      );
    }
    return NextResponse.json({
      gated: true,
      queued,
      sent: sentNow,
      total: recipients.length,
      unreachable: audience.unreachable,
      failed,
    });
  }

  // Per recipient, and settled: one bad address must not stop the rest of the
  // room hearing from the meeting they were in. And personalised per recipient:
  // each copy greets its own reader, never the host who is sending it.
  const bodies = recipients.map((r) => bodyFor(r));
  const results = await Promise.allSettled(
    recipients.map((r, i) =>
      sendEmail({
        orgId: auth.ctx.orgId,
        credentials: { gmailAccessToken: mailbox.token },
        to: { name: r.name, email: r.email },
        subject,
        htmlBody: followUpHtml(bodies[i]),
      }),
    ),
  );

  // Each delivered copy becomes an inbox thread with that attendee, linked to
  // this meeting, so the replies land in the inbox beside it — and, when it went
  // out from the host's own mailbox, that Gmail thread is tracked so the replies
  // there are read back too. Service role: the ingest ledger and the tracking
  // table are not member-writable. Never throws.
  if (hasSupabaseServiceEnv()) {
    await recordFollowUpThreads(createServiceClient(), {
      orgId: auth.ctx.orgId,
      meetingId: id,
      hostId: auth.ctx.userId,
      hostName,
      subject,
      mailbox: { source: mailbox.source, email: mailbox.email },
      sends: recipients.map((recipient, i) => ({ recipient, body: bodies[i], result: results[i] })),
    });
  }

  // One row per recipient, for the panel's delivery list and the nudge sweep.
  if (hasSupabaseServiceEnv()) {
    const sentAt = new Date().toISOString();
    await recordSends(createServiceClient(), {
      meetingId: id,
      orgId: auth.ctx.orgId,
      createdBy: auth.ctx.userId,
      subject,
      sends: recipients.map((r, i) => {
        const result = results[i];
        const value = result.status === "fulfilled" ? (result.value as { ok?: boolean; detail?: string }) : null;
        const ok = value?.ok === true;
        return {
          email: r.email,
          name: r.name,
          body: bodies[i],
          status: ok ? ("sent" as const) : ("failed" as const),
          sentAt: ok ? sentAt : null,
          error: ok ? null : (value?.detail ?? (result.status === "rejected" ? String(result.reason) : "Not delivered")).slice(0, 300),
          nudgeAfterDays: ok ? nudgeAfterDays : null,
        };
      }),
    });
  }

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
