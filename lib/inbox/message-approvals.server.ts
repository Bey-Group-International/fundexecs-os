// lib/inbox/message-approvals.server.ts
// The context an inbox message's approval card shows, for a batch of tasks.
//
// An approval for a reply used to show its task title and the description it
// was queued with — no recipient address, no subject, no sending mailbox, a
// link to a workflow page instead of the conversation. Approving an email
// blind is how the wrong thing gets sent. This reads, in a fixed number of
// queries however many cards there are: the threads, their meetings, the last
// thing each counterparty said, the CRM contact behind each address, and the
// mailbox each sender's message will go out from.
//
// Never throws: a card with less context is still a card.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/crm/contact-match";
import { grantCanSend } from "@/lib/meetings/mailbox";
import { INBOX_ACTION_LABEL } from "@/lib/inbox/action-labels";
import {
  extractInboxReply,
  legacyActionFromTask,
  replySubject,
  type InboxMessageApproval,
  type PendingInboxReply,
} from "@/lib/inbox/pending-action";

type Client = SupabaseClient<Database>;

export interface MessageTask {
  id: string;
  title?: string | null;
  description?: string | null;
  created_by?: string | null;
  result?: unknown;
  status?: string | null;
}

const PREVIEW_MAX = 280;

/** The inbox URL that opens this conversation. */
export function threadHref(thread: { counterparty_email?: string | null; subject?: string | null }): string {
  const q = thread.counterparty_email || thread.subject || "";
  return q ? `/inbox?q=${encodeURIComponent(q)}` : "/inbox";
}

export async function loadMessageApprovals(
  client: Client,
  orgId: string,
  tasks: readonly MessageTask[],
): Promise<Map<string, InboxMessageApproval>> {
  const out = new Map<string, InboxMessageApproval>();
  try {
    // 1. What each task would do: parked on it, or recovered from an older task.
    const pending = new Map<string, PendingInboxReply>();
    const legacy = new Map<string, Omit<PendingInboxReply, "threadId">>();
    for (const t of tasks) {
      const p = extractInboxReply(t.result);
      if (p) pending.set(t.id, p);
      else {
        const l = legacyActionFromTask(t);
        if (l) legacy.set(t.id, l);
      }
    }
    if (legacy.size > 0) {
      const { data } = await client
        .from("task_events")
        .select("task_id, payload")
        .eq("organization_id", orgId)
        .eq("event_type", "task.created")
        .in("task_id", [...legacy.keys()]);
      for (const e of (data ?? []) as Array<{ task_id: string; payload: { inbox_thread_id?: unknown } | null }>) {
        const threadId = e.payload?.inbox_thread_id;
        const l = legacy.get(e.task_id);
        if (l && typeof threadId === "string" && threadId) pending.set(e.task_id, { threadId, ...l });
      }
    }
    if (pending.size === 0) return out;

    // 2. The threads, then everything hanging off them, together.
    const threadIds = [...new Set([...pending.values()].map((p) => p.threadId))];
    const { data: threadRows } = await client
      .from("inbox_threads")
      .select("id, subject, channel, counterparty_name, counterparty_email, meeting_id")
      .eq("organization_id", orgId)
      .in("id", threadIds);
    type T = { id: string; subject: string; channel: string; counterparty_name: string | null; counterparty_email: string | null; meeting_id: string | null };
    const threads = new Map(((threadRows ?? []) as T[]).map((t) => [t.id, t]));

    const meetingIds = [...new Set([...threads.values()].map((t) => t.meeting_id).filter((m): m is string => Boolean(m)))];
    const emails = [...new Set([...threads.values()].map((t) => normalizeEmail(t.counterparty_email ?? "")).filter(Boolean))];
    const senders = [...new Set([...pending.values()].map((p) => p.senderId))];
    const admin = hasSupabaseServiceEnv() ? (createServiceClient() as unknown as Client) : client;

    const [meetings, inbound, contacts, mailboxes] = await Promise.all([
      meetingIds.length
        ? client.from("live_meetings").select("id, title, room_code").in("id", meetingIds)
        : Promise.resolve({ data: [] }),
      client
        .from("inbox_messages")
        .select("thread_id, body, occurred_at")
        .eq("organization_id", orgId)
        .eq("direction", "inbound")
        .in("thread_id", threadIds)
        .order("occurred_at", { ascending: false })
        .limit(Math.max(50, threadIds.length * 5)),
      emails.length
        ? client.from("network_contacts").select("email, company, title").eq("organization_id", orgId).in("email", emails)
        : Promise.resolve({ data: [] }),
      admin.from("google_calendar_connections").select("user_id, google_email, granted_scope").in("user_id", senders),
    ]);

    const meetingById = new Map(
      ((meetings.data ?? []) as Array<{ id: string; title: string | null; room_code: string }>).map((m) => [
        m.id,
        { id: m.id, title: (m.title ?? "").trim() || "Meeting", roomCode: m.room_code },
      ]),
    );
    const lastInbound = new Map<string, { body: string; at: string }>();
    for (const m of (inbound.data ?? []) as Array<{ thread_id: string; body: string; occurred_at: string }>) {
      if (!lastInbound.has(m.thread_id)) {
        const body = m.body.replace(/\s+/g, " ").trim();
        lastInbound.set(m.thread_id, {
          body: body.length > PREVIEW_MAX ? `${body.slice(0, PREVIEW_MAX - 1)}…` : body,
          at: m.occurred_at,
        });
      }
    }
    const contactByEmail = new Map(
      ((contacts.data ?? []) as Array<{ email: string | null; company: string | null; title: string | null }>).map((c) => [
        normalizeEmail(c.email ?? ""),
        { company: c.company, title: c.title },
      ]),
    );
    const fromBySender = new Map<string, string>();
    for (const m of (mailboxes.data ?? []) as Array<{ user_id: string; google_email: string | null; granted_scope: string | null }>) {
      if (m.google_email && grantCanSend(m.granted_scope)) fromBySender.set(m.user_id, m.google_email);
    }

    for (const t of tasks) {
      const p = pending.get(t.id);
      if (!p) continue;
      const thread = threads.get(p.threadId);
      if (!thread) continue;
      const email = normalizeEmail(thread.counterparty_email ?? "");
      const stored = extractInboxReply(t.result);
      const failed = t.status === "failed" && stored && !stored.delivered;
      out.set(t.id, {
        taskId: t.id,
        threadId: p.threadId,
        action: p.action,
        actionLabel: INBOX_ACTION_LABEL[p.action] ?? p.action.replace(/_/g, " "),
        body: p.body,
        sharePreface: p.sharePreface ?? null,
        to: { name: thread.counterparty_name, email: thread.counterparty_email },
        subject: p.action === "send_reply" ? replySubject(thread.subject) : thread.subject,
        from: thread.channel === "gmail" ? (fromBySender.get(p.senderId) ?? null) : null,
        threadHref: threadHref(thread),
        meeting: thread.meeting_id ? (meetingById.get(thread.meeting_id) ?? null) : null,
        contact: email ? (contactByEmail.get(email) ?? null) : null,
        lastInbound: lastInbound.get(p.threadId) ?? null,
        editable: p.action === "send_reply" && Boolean(p.body),
        failed: failed ? { error: (t.result as { inboxReply?: { error?: string } }).inboxReply?.error || "It could not be sent." } : null,
      });
    }
  } catch (err) {
    console.warn("[inbox/message-approvals] context unavailable", err);
  }
  return out;
}

/** How far back an approved-but-undelivered message stays on the inbox to retry. */
export const FAILED_MESSAGE_DAYS = 14;

/** Approved inbox messages that failed to deliver, recently enough to retry. */
export async function fetchFailedInboxMessages(client: Client, orgId: string): Promise<MessageTask[]> {
  try {
    const since = new Date(Date.now() - FAILED_MESSAGE_DAYS * 86_400_000).toISOString();
    const { data } = await client
      .from("tasks")
      .select("id, title, description, created_by, result, status, assigned_agent, hub, created_at, session_id, meeting_id")
      .eq("organization_id", orgId)
      .is("parent_task_id", null)
      .eq("status", "failed")
      .not("result->inboxReply", "is", null)
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(25);
    return ((data ?? []) as MessageTask[]).filter((t) => {
      const p = extractInboxReply(t.result);
      return Boolean(p && !p.delivered);
    });
  } catch {
    return [];
  }
}
