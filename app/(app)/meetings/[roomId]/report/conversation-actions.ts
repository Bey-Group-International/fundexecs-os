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
import { conversationProblem, personalizeGroupBody, type ConversationDraft } from "@/lib/meetings/conversation";
import { draftMeetingConversation } from "@/lib/meetings/conversation-draft.server";
import { ensureMeetingThread } from "@/lib/meetings/meeting-thread.server";
import { replyToThread } from "@/app/(app)/inbox/actions";
import { checkSendingMailbox } from "@/lib/inbox/deliver-reply.server";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

interface MeetingContext {
  supabase: ServerClient;
  orgId: string;
  userId: string;
  meeting: { id: string; title: string | null };
  /** Everyone this meeting may write to: invited or present, minus the sender. */
  recipients: MeetingRecipient[];
}

interface Context extends MeetingContext {
  recipient: MeetingRecipient;
}

async function meetingContextFor(
  meetingId: string,
): Promise<{ ok: true; ctx: MeetingContext } | { ok: false; error: string }> {
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

  return {
    ok: true,
    ctx: {
      supabase,
      orgId: auth.ctx.orgId,
      userId: auth.ctx.userId,
      meeting: { id: meeting.id as string, title: (meeting.title as string | null) ?? null },
      recipients,
    },
  };
}

function recipientIn(recipients: readonly MeetingRecipient[], email: string): MeetingRecipient | null {
  const wanted = normalizeEmail(email);
  if (!wanted) return null;
  return recipients.find((r) => normalizeEmail(r.email) === wanted) ?? null;
}

async function contextFor(
  meetingId: string,
  email: string,
): Promise<{ ok: true; ctx: Context } | { ok: false; error: string }> {
  const m = await meetingContextFor(meetingId);
  if (!m.ok) return m;
  const recipient = recipientIn(m.ctx.recipients, email);
  if (!recipient) return { ok: false, error: "That person was not in this meeting." };
  return { ok: true, ctx: { ...m.ctx, recipient } };
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
  | { ok: false; error: string; needsMailbox?: boolean };

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

  // Before any thread is made: a message nobody can send is refused with the fix.
  const mailbox = await checkSendingMailbox(ctx.supabase, ctx.userId, ctx.orgId);
  if (!mailbox.ok) return mailbox;

  return sendOne(ctx, ctx.recipient, subject, body);
}

/** One attendee's message: their meeting thread, the inbox's gated send, the cached draft dropped. */
async function sendOne(
  ctx: MeetingContext,
  recipient: MeetingRecipient,
  subject: string,
  body: string,
): Promise<StartConversationResult> {
  // This meeting's thread with them if there is one (the follow-up, or an
  // earlier conversation), else the reply-key thread, else a new one.
  const thread = await ensureMeetingThread(ctx.supabase, {
    orgId: ctx.orgId,
    actorId: ctx.userId,
    meetingId: ctx.meeting.id,
    recipient,
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
  if (!result.ok) {
    return { ok: false, error: result.error ?? "The message could not be sent.", needsMailbox: result.needsMailbox };
  }

  // The cached Earn draft has been used (or overridden); drop it.
  await ctx.supabase
    .from("meeting_conversation_drafts")
    .delete()
    .eq("organization_id", ctx.orgId)
    .eq("meeting_id", ctx.meeting.id)
    .eq("email_lower", normalizeEmail(recipient.email));

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

/** The most people one "Message everyone new" may write to in a single send. */
const MAX_BATCH_RECIPIENTS = 50;
/** How many attendees are written to at once; enough to be quick, few enough to be polite to the mail API. */
const BATCH_CONCURRENCY = 4;

export interface BatchOutcome {
  email: string;
  name: string;
  ok: boolean;
  gated?: boolean;
  error?: string;
}

export type StartConversationsResult =
  | { ok: true; results: BatchOutcome[] }
  | { ok: false; error: string; needsMailbox?: boolean };

/**
 * "Message everyone new" in one round trip: the meeting and its attendee list are
 * read once, then each person gets their own thread and their own first name in
 * the greeting, a few at a time. Every send still goes through the inbox's gate,
 * and one person failing is reported by name without stopping the rest. The work
 * is on the server, so closing the tab mid-send does not cut the list short.
 */
export async function startConversations(input: {
  meetingId: string;
  subject: string;
  /** May carry {first_name}, replaced per person. */
  body: string;
  emails: string[];
}): Promise<StartConversationsResult> {
  const subject = String(input.subject ?? "").trim();
  const body = String(input.body ?? "").trim();
  const problem = conversationProblem({ subject, body });
  if (problem) return { ok: false, error: problem };

  const emails = Array.from(new Set((input.emails ?? []).map((e) => normalizeEmail(String(e))).filter(Boolean)));
  if (emails.length === 0) return { ok: false, error: "Nobody to send to." };
  if (emails.length > MAX_BATCH_RECIPIENTS) {
    return { ok: false, error: `That is more than ${MAX_BATCH_RECIPIENTS} people — send in smaller groups.` };
  }

  const m = await meetingContextFor(input.meetingId);
  if (!m.ok) return m;
  const { ctx } = m;

  // One batch is one act; the per-message limit would cut a large meeting off halfway.
  const rl = checkRateLimit({ key: `org:${ctx.orgId}:meeting-conversation-batch`, limit: 5, windowMs: 60_000 });
  if (!rl.ok) return { ok: false, error: "Too many group messages at once — try again in a minute." };

  // Once for the batch: without a mailbox every one of them would fail the same way.
  const mailbox = await checkSendingMailbox(ctx.supabase, ctx.userId, ctx.orgId);
  if (!mailbox.ok) return mailbox;

  const results: BatchOutcome[] = new Array(emails.length);
  let next = 0;
  async function worker() {
    while (next < emails.length) {
      const i = next++;
      const recipient = recipientIn(ctx.recipients, emails[i]);
      if (!recipient) {
        results[i] = { email: emails[i], name: "", ok: false, error: "not in this meeting" };
        continue;
      }
      try {
        const r = await sendOne(ctx, recipient, subject, personalizeGroupBody(body, recipient.name));
        results[i] = r.ok
          ? { email: recipient.email, name: recipient.name, ok: true, gated: r.gated }
          : { email: recipient.email, name: recipient.name, ok: false, error: r.error };
      } catch {
        results[i] = { email: recipient.email, name: recipient.name, ok: false, error: "failed" };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, emails.length) }, worker));
  return { ok: true, results };
}
