// lib/meetings/meeting-thread.server.ts
// The inbox thread a meeting has with one attendee: found, or created.
//
// One rule for every path that writes to an attendee on a meeting's behalf —
// the follow-up when it is gated, and a conversation started from the report:
//
//   1. a thread already linked to THIS meeting with this person is continued,
//      whatever its subject (the follow-up thread, or an earlier conversation),
//      so one meeting is one conversation per person, not one per send;
//   2. otherwise a thread on the reply key (counterparty + normalised subject)
//      is reused and linked, so the answer lands where it would anyway;
//   3. otherwise one is created, linked to the meeting and put on the person's
//      CRM timeline.
//
// Through the caller's client: RLS (is_org_writer) decides who may create it.

import type { createServerClient } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/crm/contact-match";
import { followUpThreadKey } from "@/lib/meetings/follow-up-threads.server";
import { computePriority } from "@/lib/inbox/intelligence";
import { recordThreadOnTimeline } from "@/lib/inbox/crm-activity.server";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

export interface MeetingThreadInput {
  orgId: string;
  actorId: string;
  meetingId: string;
  recipient: { name: string; email: string };
  /** The subject for a new thread; ignored when an existing one is continued. */
  subject: string;
  /** The opening text, for a new thread's preview and timeline entry. */
  preview: string;
}

export type MeetingThreadResult =
  | { ok: true; threadId: string; subject: string; continued: boolean }
  | { ok: false; error: string };

export async function ensureMeetingThread(
  supabase: ServerClient,
  input: MeetingThreadInput,
): Promise<MeetingThreadResult> {
  const email = normalizeEmail(input.recipient.email);
  if (!email) return { ok: false, error: "That attendee has no usable address." };

  // 1. This meeting's thread with this person.
  const { data: own } = await supabase
    .from("inbox_threads")
    .select("id, subject")
    .eq("organization_id", input.orgId)
    .eq("meeting_id", input.meetingId)
    .eq("counterparty_email_lower", email)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (own) {
    return { ok: true, threadId: own.id as string, subject: (own.subject as string) ?? input.subject, continued: true };
  }

  // 2. The thread the reply key resolves to.
  const threadKey = followUpThreadKey(email, input.subject);
  const { data: keyed } = await supabase
    .from("inbox_threads")
    .select("id, subject")
    .eq("organization_id", input.orgId)
    .eq("channel", "gmail")
    .eq("external_id", threadKey)
    .maybeSingle();
  if (keyed) {
    await supabase
      .from("inbox_threads")
      .update({ meeting_id: input.meetingId })
      .eq("organization_id", input.orgId)
      .eq("id", keyed.id as string);
    return { ok: true, threadId: keyed.id as string, subject: (keyed.subject as string) ?? input.subject, continued: true };
  }

  // 3. A new one.
  const now = new Date().toISOString();
  const preview = input.preview.replace(/\s+/g, " ").slice(0, 200);
  const { data: created, error } = await supabase
    .from("inbox_threads")
    .insert({
      organization_id: input.orgId,
      channel: "gmail",
      category: "messaging",
      subject: input.subject,
      counterparty_name: input.recipient.name || null,
      counterparty_email: email,
      preview,
      unread: false,
      status: "open",
      priority: computePriority({ category: "messaging", unread: false, hasContext: true, ageHours: 0, intent: null }),
      last_message_at: now,
      meeting_id: input.meetingId,
      external_id: threadKey,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Could not start the conversation." };

  await recordThreadOnTimeline(supabase as never, {
    orgId: input.orgId,
    actorId: input.actorId,
    now,
    thread: {
      id: created.id as string,
      channel: "gmail",
      subject: input.subject,
      counterpartyEmail: email,
      aiSummary: null,
      preview,
      lastMessageAt: now,
    },
  });
  return { ok: true, threadId: created.id as string, subject: input.subject, continued: false };
}
