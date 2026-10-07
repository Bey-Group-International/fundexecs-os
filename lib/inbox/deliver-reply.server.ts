// lib/inbox/deliver-reply.server.ts
// Putting an inbox reply into somebody's inbox.
//
// Two paths reach here: a reply sent immediately from the inbox (or from a
// meeting report, which sends through the inbox), and a reply that waited for
// approval and has just been approved. Both used to fail an invitee in ways
// nobody was told about:
//
//   - the reply went out with the subject "(no subject)", because nothing ever
//     passed the thread's subject to the mail adapter — so the invitee saw a
//     blank subject and their answer came back as "Re: (no subject)", a thread
//     the meeting could not recognise;
//   - it went out only through the ORGANIZATION's mailbox. A host who had
//     connected their own Gmail (enough for the meeting follow-up) got a saved
//     draft instead, reported back as success;
//   - and an APPROVED reply was never sent at all: approving ran the generic
//     workflow engine, which found no steps and marked the task complete.
//
// Email replies now go from the composer's own mailbox, falling back to the
// org's (mailboxFor — the same rule as the follow-up), under "Re: <subject>",
// and are refused with the reason when no mailbox exists, never saved as a
// draft and counted as sent. A Gmail thread sent from a member's own mailbox
// is tracked so the answers are read back. Non-email channels keep the adapter
// dispatch they always had.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, InboxThread, Json } from "@/lib/supabase/database.types";
import { sendEmail, escapeHtml } from "@/lib/email";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { dispatchAction } from "@/lib/integrations";
import { orgConnectedChannels } from "@/lib/integrations/gateway";
import { recordDispatch } from "@/lib/integrations/log";
import type { DispatchContext, DispatchResult } from "@/lib/integrations/types";
import type { ActionKind } from "@/lib/gates";
import { isVerifiable } from "@/lib/grounding";
import {
  extractInboxReply,
  legacyActionFromTask,
  replySubject,
  type PendingInboxReply,
} from "@/lib/inbox/pending-action";
import type { AgentKey } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type { PendingInboxReply } from "@/lib/inbox/pending-action";
export { extractInboxReply, replySubject } from "@/lib/inbox/pending-action";

/**
 * An inbox action queued before actions were parked on the task (inboxReply),
 * rebuilt from what that version did record: the composed text in a reply's
 * description, the action in the task's title, and the thread on its
 * task.created event. Without this, everything already waiting in approvals
 * when the fix shipped would still approve into nothing.
 */
export async function legacyInboxReply(
  client: Client,
  task: { id: string; title?: string | null; description?: string | null; created_by?: string | null },
): Promise<PendingInboxReply | null> {
  const legacy = legacyActionFromTask(task);
  if (!legacy) return null;

  const { data } = await client
    .from("task_events")
    .select("payload")
    .eq("task_id", task.id)
    .eq("event_type", "task.created")
    .limit(1)
    .maybeSingle();
  const threadId = (data as { payload?: { inbox_thread_id?: unknown } } | null)?.payload?.inbox_thread_id;
  if (typeof threadId !== "string" || !threadId) return null;
  return { threadId, ...legacy };
}

/** An email thread: a reply to it is an email to its counterparty. */
export function isEmailThread(t: Pick<InboxThread, "channel" | "counterparty_email">): boolean {
  return t.channel === "gmail" && Boolean(t.counterparty_email);
}


export function replyHtml(body: string): string {
  const escaped = escapeHtml(body);
  return escaped ? `<p>${escaped.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>` : "";
}

/** A client that can read another member's mailbox grant and write the tracking table. */
function privileged(fallback: Client): Client {
  return hasSupabaseServiceEnv() ? (createServiceClient() as unknown as Client) : fallback;
}

export type MailboxCheck = { ok: true } | { ok: false; error: string; needsMailbox: true };

/**
 * Whether this sender can send email at all, before anything is queued — so a
 * reply nobody could ever send is refused while its author is still looking at
 * it, rather than approved later into nothing.
 */
export async function checkSendingMailbox(client: Client, senderId: string, orgId: string): Promise<MailboxCheck> {
  const mailbox = await mailboxFor(privileged(client), senderId, orgId);
  if (mailbox.ok) return { ok: true };
  return { ok: false, needsMailbox: true, error: mailboxProblemMessage(mailbox.problem) };
}

export interface DeliverInput {
  orgId: string;
  /** Whose mailbox sends it. */
  senderId: string;
  thread: InboxThread;
  action: ActionKind;
  body?: string;
  /** Composer work product behind the action, for the dispatch trust gate. */
  backingArtifact?: DispatchContext["backingArtifact"];
}

export type DeliverResult = DispatchResult & { needsMailbox?: boolean };

/** Send it. Email threads from the sender's mailbox; everything else through its adapter. */
export async function deliverThreadAction(client: Client, input: DeliverInput): Promise<DeliverResult> {
  const t = input.thread;
  if (input.action === "send_reply" && isEmailThread(t) && input.body) {
    // The same trust gate dispatchAction applies: unverified work product does not leave.
    if (input.backingArtifact && !isVerifiable(input.backingArtifact)) {
      return {
        ok: false,
        channel: "gmail",
        live: false,
        gated: true,
        detail:
          "Blocked at the trust gate: unverified, weakly-grounded work product cannot be sent to a counterparty. Verify it first.",
      };
    }
    const admin = privileged(client);
    const mailbox = await mailboxFor(admin, input.senderId, input.orgId);
    if (!mailbox.ok) {
      const message = mailboxProblemMessage(mailbox.problem);
      return { ok: false, channel: "gmail", live: false, detail: message, error: message, needsMailbox: true };
    }
    const to = t.counterparty_email as string;
    const sent = await sendEmail({
      orgId: input.orgId,
      credentials: { gmailAccessToken: mailbox.token },
      to: { name: t.counterparty_name ?? to, email: to },
      subject: replySubject(t.subject),
      htmlBody: replyHtml(input.body),
    });
    if (!sent.ok) {
      return {
        ok: false,
        channel: "gmail",
        live: true,
        detail: `Email to ${to} could not be delivered. ${sent.detail}`,
        error: sent.detail,
      };
    }
    // A member's own mailbox is not swept; tracking this Gmail thread is what
    // brings the answer back into the inbox. The org mailbox is swept already.
    if (mailbox.source === "member" && sent.gmailThreadId) {
      const { error } = await admin.from("tracked_mail_threads").upsert(
        {
          organization_id: input.orgId,
          user_id: input.senderId,
          gmail_thread_id: sent.gmailThreadId,
          inbox_thread_id: t.id,
          meeting_id: t.meeting_id ?? null,
          mailbox_email: mailbox.email,
        },
        { onConflict: "user_id,gmail_thread_id" },
      );
      if (error) console.warn("[deliver-reply] tracking failed", error.message);
    }
    return {
      ok: true,
      channel: "gmail",
      live: true,
      detail: `Email sent to ${t.counterparty_name ?? to}.`,
      reference: sent.gmailMessageId,
    };
  }

  const connected = await orgConnectedChannels(client, input.orgId);
  return dispatchAction({
    orgId: input.orgId,
    actorId: input.senderId,
    action: input.action,
    channel: t.channel,
    connected: connected.has(t.channel),
    target: { name: t.counterparty_name ?? undefined, email: t.counterparty_email ?? undefined },
    subject: input.action === "send_reply" ? replySubject(t.subject) : undefined,
    body: input.body,
    backingArtifact: input.backingArtifact,
  });
}

/**
 * Deliver a reply that waited for approval and has just been approved, and
 * record what happened on the thread and the task exactly as an immediate send
 * would. Never throws; the outcome is on the task.
 */
export async function deliverApprovedReply(
  client: Client,
  input: { orgId: string; approverId: string; taskId: string; agent: AgentKey | null; hub: string | null; reply: PendingInboxReply },
): Promise<{ ok: boolean; error?: string }> {
  const { reply } = input;
  const now = () => new Date().toISOString();
  const finish = async (ok: boolean, patch: Record<string, unknown>, error?: string) => {
    await client
      .from("tasks")
      .update({
        status: ok ? "completed" : "failed",
        progress: 1,
        completed_at: now(),
        result: { inboxReply: { ...reply, delivered: ok, error }, ...patch } as unknown as Json,
      })
      .eq("organization_id", input.orgId)
      .eq("id", input.taskId);
    await client.from("task_events").insert({
      organization_id: input.orgId,
      task_id: input.taskId,
      event_type: "task.completed",
      agent: input.agent,
      hub: input.hub,
      payload: { ok, approved: true, error: error ?? null } as Json,
    } as never);
    return { ok, error };
  };

  const { data: thread } = await client
    .from("inbox_threads")
    .select("*")
    .eq("organization_id", input.orgId)
    .eq("id", reply.threadId)
    .maybeSingle();
  if (!thread) return finish(false, {}, "The conversation no longer exists.");
  const t = thread as InboxThread;

  let result: DeliverResult;
  try {
    result = await deliverThreadAction(client, {
      orgId: input.orgId,
      senderId: reply.senderId,
      thread: t,
      action: reply.action,
      body: reply.body ?? undefined,
      backingArtifact: reply.backingArtifact ?? undefined,
    });
  } catch (err) {
    return finish(false, {}, err instanceof Error ? err.message : "Delivery failed.");
  }

  await recordDispatch(client, {
    orgId: input.orgId,
    actorId: input.approverId,
    taskId: input.taskId,
    action: reply.action,
    result,
  });

  if (!result.ok) return finish(false, { dispatch: result }, result.error ?? result.detail);

  const at = now();
  // What lands on the thread, as for an immediate run: the composed reply, else
  // the (prefaced) dispatch outcome.
  const recorded = reply.body
    ? reply.body
    : reply.sharePreface
      ? `${reply.sharePreface}\n\n${result.detail}`
      : result.detail;
  await client.from("inbox_messages").insert({
    organization_id: input.orgId,
    thread_id: t.id,
    direction: "outbound",
    author: "Earn",
    body: recorded,
    occurred_at: at,
    metadata: {
      action: reply.action,
      channel: result.channel,
      reference: result.reference ?? null,
      dispatch_detail: result.detail,
      approved: true,
    } as Json,
  });
  // A booking or video link a live dispatch produced travels with the thread,
  // exactly as performThreadAction keeps it — never a mock's placeholder.
  const patch: Partial<InboxThread> = { unread: false, last_message_at: at };
  if (result.live && result.reference && (reply.action === "create_video_meeting" || reply.action === "confirm_booking")) {
    patch.meeting_url = result.reference;
    if (reply.action === "confirm_booking" && !t.meeting_at) patch.meeting_at = at;
  }
  await client.from("inbox_threads").update(patch).eq("organization_id", input.orgId).eq("id", t.id);
  return finish(true, { dispatch: result });
}
