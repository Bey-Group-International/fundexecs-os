"use server";

// Starting an inbox conversation with an attendee, from the meeting's report.
//
// Two actions behind the composer on the report page (StartConversation.tsx):
//
//   draftConversation — "Draft with Earn". Only on request, on the small model,
//     from the report's own summary, decisions and action items.
//   startConversation — finds or creates the inbox thread with that attendee,
//     linked to this meeting and keyed the way their replies will be keyed,
//     then sends through replyToThread: the SAME gate and dispatch loop as any
//     inbox reply, so an org that requires approval for outbound mail gets it
//     here too. The reply lands on the thread whichever route it comes back by.
//
// Both refuse anybody outside the meeting's organisation, and both only write to
// someone who was actually in the meeting (invited or present) — the composer is
// for continuing a conversation the meeting started, not an open mail form.

import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/crm/contact-match";
import { meetingRecipients, type MeetingRecipient } from "@/lib/meetings/recipients";
import { loadPresentPeople } from "@/lib/meetings/recipients.server";
import { normalizeNoteList } from "@/lib/meetings/live-notes";
import { reportActionItems } from "@/lib/meetings/action-item-source";
import { conversationProblem, type ConversationDraft } from "@/lib/meetings/conversation";
import { draftMeetingConversation } from "@/lib/meetings/conversation-draft.server";
import { ensureMeetingThread } from "@/lib/meetings/meeting-thread.server";
import { replyToThread } from "@/app/(app)/inbox/actions";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

interface Context {
  supabase: ServerClient;
  orgId: string;
  userId: string;
  meeting: { id: string; title: string | null };
  recipient: MeetingRecipient;
}

async function contextFor(
  meetingId: string,
  email: string,
): Promise<{ ok: true; ctx: Context } | { ok: false; error: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();

  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, title, organization_id, attendees")
    .eq("id", meetingId)
    .is("deleted_at", null)
    .maybeSingle();
  // Org members only: a guest attendee can read the report but has no inbox here.
  if (!meeting || meeting.organization_id !== auth.ctx.orgId) {
    return { ok: false, error: "Meeting not found." };
  }

  const present = await loadPresentPeople(supabase, meetingId);
  const { recipients } = meetingRecipients({
    invited: meeting.attendees,
    present,
    senderEmail: auth.ctx.email,
  });
  const wanted = normalizeEmail(email);
  const recipient = recipients.find((r) => normalizeEmail(r.email) === wanted);
  if (!wanted || !recipient) return { ok: false, error: "That person was not in this meeting." };

  return {
    ok: true,
    ctx: {
      supabase,
      orgId: auth.ctx.orgId,
      userId: auth.ctx.userId,
      meeting: { id: meeting.id as string, title: (meeting.title as string | null) ?? null },
      recipient,
    },
  };
}

export type DraftConversationResult =
  | ({ ok: true; live: boolean; cached: boolean } & ConversationDraft)
  | { ok: false; error: string };

export async function draftConversation(meetingId: string, email: string): Promise<DraftConversationResult> {
  const c = await contextFor(meetingId, email);
  if (!c.ok) return c;
  const { ctx } = c;

  const rl = checkRateLimit({ key: `org:${ctx.orgId}:meeting-conversation-draft`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return { ok: false, error: "Too many drafts at once — try again in a minute." };

  // The newest report, through the caller's client: RLS limits it to people who
  // were in the meeting, and a reader who may not see it drafts from the title.
  const { data: report } = await ctx.supabase
    .from("live_meeting_reports")
    .select("summary, action_items, analysis, created_at")
    .eq("meeting_id", ctx.meeting.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = report as { summary?: string | null; action_items?: unknown; analysis?: unknown; created_at?: string | null } | null;
  const reportAt = r?.created_at ?? null;
  const emailLower = normalizeEmail(ctx.recipient.email);

  // A draft already written from this same report is reused: reopening the
  // composer, or a second person drafting to the same attendee, costs nothing.
  const { data: cached } = await ctx.supabase
    .from("meeting_conversation_drafts")
    .select("subject, body, report_created_at")
    .eq("organization_id", ctx.orgId)
    .eq("meeting_id", ctx.meeting.id)
    .eq("email_lower", emailLower)
    .maybeSingle();
  if (cached && (cached.report_created_at ?? null) === reportAt) {
    return { ok: true, live: true, cached: true, subject: cached.subject as string, body: cached.body as string };
  }

  const analysis = (r?.analysis ?? null) as Record<string, unknown> | null;
  const draft = await draftMeetingConversation({
    meetingTitle: ctx.meeting.title,
    recipientName: ctx.recipient.name,
    summary: r?.summary ?? null,
    decisions: normalizeNoteList(analysis?.decisions),
    actionItems: r ? reportActionItems(r.action_items, analysis) : [],
  });

  // Only a real model draft is worth keeping; the template is free to rebuild.
  if (draft.live) {
    await ctx.supabase.from("meeting_conversation_drafts").upsert(
      {
        organization_id: ctx.orgId,
        meeting_id: ctx.meeting.id,
        email_lower: emailLower,
        subject: draft.subject,
        body: draft.body,
        report_created_at: reportAt,
        created_by: ctx.userId,
        created_at: new Date().toISOString(),
      },
      { onConflict: "meeting_id,email_lower" },
    );
  }
  return { ok: true, cached: false, ...draft };
}

export type StartConversationResult =
  | { ok: true; threadId: string; continued: boolean; subject: string; gated: boolean; message: string }
  | { ok: false; error: string };

export async function startConversation(formData: FormData): Promise<StartConversationResult> {
  const meetingId = String(formData.get("meeting_id") ?? "");
  const email = String(formData.get("email") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const problem = conversationProblem({ subject, body });
  if (problem) return { ok: false, error: problem };

  const c = await contextFor(meetingId, email);
  if (!c.ok) return c;
  const { ctx } = c;

  const rl = checkRateLimit({ key: `org:${ctx.orgId}:meeting-conversation`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return { ok: false, error: "Too many messages at once — try again in a minute." };

  // This meeting's thread with them if there is one (the follow-up, or an
  // earlier conversation), else the reply-key thread, else a new one.
  const thread = await ensureMeetingThread(ctx.supabase, {
    orgId: ctx.orgId,
    actorId: ctx.userId,
    meetingId: ctx.meeting.id,
    recipient: ctx.recipient,
    subject,
    preview: body,
  });
  if (!thread.ok) return thread;
  const threadId = thread.threadId;

  // The inbox's own send: gate, approval or dispatch, outbound message recorded.
  const fd = new FormData();
  fd.set("thread_id", threadId);
  fd.set("body", body);
  const result = await replyToThread(fd);
  if (!result.ok) return { ok: false, error: result.error ?? "The message could not be sent." };

  // The cached Earn draft has been used (or overridden); drop it.
  await ctx.supabase
    .from("meeting_conversation_drafts")
    .delete()
    .eq("organization_id", ctx.orgId)
    .eq("meeting_id", ctx.meeting.id)
    .eq("email_lower", normalizeEmail(ctx.recipient.email));

  return {
    ok: true,
    threadId,
    continued: thread.continued,
    subject: thread.subject,
    gated: Boolean(result.gated),
    message: result.gated
      ? (result.message ?? "Sent to your approvals before it goes out.")
      : (result.message ?? "Sent."),
  };
}
