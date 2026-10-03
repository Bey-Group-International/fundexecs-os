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
import { followUpThreadKey } from "@/lib/meetings/follow-up-threads.server";
import { computePriority } from "@/lib/inbox/intelligence";
import { recordThreadOnTimeline } from "@/lib/inbox/crm-activity.server";
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
  | ({ ok: true; live: boolean } & ConversationDraft)
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
    .select("summary, action_items, analysis")
    .eq("meeting_id", ctx.meeting.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const analysis = ((report as { analysis?: unknown } | null)?.analysis ?? null) as Record<string, unknown> | null;

  const draft = await draftMeetingConversation({
    meetingTitle: ctx.meeting.title,
    recipientName: ctx.recipient.name,
    summary: (report as { summary?: string | null } | null)?.summary ?? null,
    decisions: normalizeNoteList(analysis?.decisions),
    actionItems: report ? reportActionItems((report as { action_items?: unknown }).action_items, analysis) : [],
  });
  return { ok: true, ...draft };
}

export type StartConversationResult =
  | { ok: true; threadId: string; gated: boolean; message: string }
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

  const counterparty = normalizeEmail(ctx.recipient.email);
  const threadKey = followUpThreadKey(counterparty, subject);
  const now = new Date().toISOString();

  // Find-or-create on the same key an inbound reply resolves to, so the answer
  // lands on this thread whether it arrives by webhook or by a mailbox sweep.
  const { data: existing } = await ctx.supabase
    .from("inbox_threads")
    .select("id, meeting_id")
    .eq("organization_id", ctx.orgId)
    .eq("channel", "gmail")
    .eq("external_id", threadKey)
    .maybeSingle();

  let threadId: string;
  if (existing) {
    threadId = existing.id as string;
    if (!existing.meeting_id) {
      await ctx.supabase
        .from("inbox_threads")
        .update({ meeting_id: ctx.meeting.id })
        .eq("organization_id", ctx.orgId)
        .eq("id", threadId);
    }
  } else {
    const { data: created, error } = await ctx.supabase
      .from("inbox_threads")
      .insert({
        organization_id: ctx.orgId,
        channel: "gmail",
        category: "messaging",
        subject,
        counterparty_name: ctx.recipient.name || null,
        counterparty_email: counterparty,
        preview: body.replace(/\s+/g, " ").slice(0, 200),
        unread: false,
        status: "open",
        priority: computePriority({ category: "messaging", unread: false, hasContext: true, ageHours: 0, intent: null }),
        last_message_at: now,
        meeting_id: ctx.meeting.id,
        external_id: threadKey,
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: error?.message ?? "Could not start the conversation." };
    threadId = created.id as string;

    // Onto the person's CRM record, the same entry an inbound thread makes.
    await recordThreadOnTimeline(ctx.supabase as never, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      now,
      thread: {
        id: threadId,
        channel: "gmail",
        subject,
        counterpartyEmail: counterparty,
        aiSummary: null,
        preview: body.slice(0, 200),
        lastMessageAt: now,
      },
    });
  }

  // The inbox's own send: gate, approval or dispatch, outbound message recorded.
  const fd = new FormData();
  fd.set("thread_id", threadId);
  fd.set("body", body);
  const result = await replyToThread(fd);
  if (!result.ok) return { ok: false, error: result.error ?? "The message could not be sent." };
  return {
    ok: true,
    threadId,
    gated: Boolean(result.gated),
    message: result.gated
      ? (result.message ?? "Sent to your approvals before it goes out.")
      : (result.message ?? "Sent."),
  };
}
