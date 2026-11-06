// lib/meetings/follow-up-sends.server.ts
// The record of a follow-up, recipient by recipient: what was scheduled, what
// went, what failed and why, and who has answered.
//
// Every read and write here is soft: the table arrives with a migration that
// may not have run yet, and the follow-up must still send without it.

import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import type { SendRow, TemplateContext } from "@/lib/meetings/follow-up-loop";

type Db = { from: (table: string) => any };

export const SEND_COLUMNS =
  "id, email, name, status, scheduled_for, sent_at, error, nudge_after_days, nudged_at, replied_at, created_at";

export interface NewSend {
  email: string;
  name: string | null;
  body: string;
  status: SendRow["status"];
  error?: string | null;
  sentAt?: string | null;
  scheduledFor?: string | null;
  nudgeAfterDays?: number | null;
}

/** Write one row per recipient. Returns how many were written (0 when the table is missing). */
export async function recordSends(
  db: Db,
  input: { meetingId: string; orgId: string; createdBy: string; subject: string; sends: readonly NewSend[] },
): Promise<number> {
  if (!input.sends.length) return 0;
  try {
    const { data, error } = await db
      .from("live_meeting_followup_sends")
      .insert(
        input.sends.map((s) => ({
          meeting_id: input.meetingId,
          organization_id: input.orgId,
          created_by: input.createdBy,
          email: s.email,
          name: s.name,
          subject: input.subject,
          body: s.body,
          status: s.status,
          error: s.error ?? null,
          sent_at: s.sentAt ?? null,
          scheduled_for: s.scheduledFor ?? null,
          nudge_after_days: s.nudgeAfterDays ?? null,
        })),
      )
      .select("id");
    if (error) {
      console.warn("[follow-up-sends] could not record sends", error.message);
      return 0;
    }
    return Array.isArray(data) ? data.length : 0;
  } catch (err) {
    console.warn("[follow-up-sends] could not record sends", err);
    return 0;
  }
}

/**
 * When each recipient first answered on their thread for this meeting, after
 * the time they were sent to. Keyed by lower-cased address.
 */
export async function repliesSince(db: Db, meetingId: string, sentAt: Map<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!sentAt.size) return out;
  try {
    const { data: threads } = await db
      .from("inbox_threads")
      .select("id, counterparty_email")
      .eq("meeting_id", meetingId)
      .in("counterparty_email", [...sentAt.keys()]);
    const byThread = new Map<string, string>();
    for (const t of (threads ?? []) as Array<{ id: string; counterparty_email: string | null }>) {
      if (t.counterparty_email) byThread.set(t.id, t.counterparty_email.toLowerCase());
    }
    if (!byThread.size) return out;
    const { data: messages } = await db
      .from("inbox_messages")
      .select("thread_id, occurred_at")
      .in("thread_id", [...byThread.keys()])
      .eq("direction", "inbound")
      .order("occurred_at", { ascending: true });
    for (const m of (messages ?? []) as Array<{ thread_id: string; occurred_at: string }>) {
      const email = byThread.get(m.thread_id);
      if (!email || out.has(email)) continue;
      const since = sentAt.get(email);
      if (since && Date.parse(m.occurred_at) > Date.parse(since)) out.set(email, m.occurred_at);
    }
  } catch {
    // No replies known; the line reads "sent" until they are.
  }
  return out;
}

/**
 * A meeting's send rows, with replies folded in: any sent row whose recipient
 * has since answered gets its replied_at filled, and the fill is saved so the
 * sweep stops nudging them. `available` false when the table is missing.
 */
export async function loadSends(db: Db, meetingId: string): Promise<{ rows: SendRow[]; available: boolean }> {
  try {
    const { data, error } = await db
      .from("live_meeting_followup_sends")
      .select(SEND_COLUMNS)
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) return { rows: [], available: (error as { code?: string }).code !== "42P01" };
    const rows = (data ?? []) as SendRow[];
    const waiting = new Map<string, string>();
    for (const r of rows) {
      if (r.status === "sent" && r.sent_at && !r.replied_at) waiting.set(r.email.toLowerCase(), r.sent_at);
    }
    const replies = await repliesSince(db, meetingId, waiting);
    for (const r of rows) {
      const at = replies.get(r.email.toLowerCase());
      if (at && r.status === "sent" && !r.replied_at && r.sent_at && Date.parse(at) > Date.parse(r.sent_at)) {
        r.replied_at = at;
        await db.from("live_meeting_followup_sends").update({ replied_at: at, updated_at: new Date().toISOString() }).eq("id", r.id);
      }
    }
    return { rows, available: true };
  } catch {
    return { rows: [], available: false };
  }
}

/** The report's content a template is filled from. */
export async function templateContext(
  db: Db,
  meetingId: string,
  meetingTitle: string,
  hostName: string | null,
): Promise<TemplateContext> {
  const { data } = await db
    .from("live_meeting_reports")
    .select("summary, analysis")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = (data ?? null) as { summary?: unknown; analysis?: Record<string, unknown> | null } | null;
  const analysis = row?.analysis ?? {};
  return {
    meetingTitle,
    hostName,
    summary: normalizeNoteText(row?.summary ?? analysis.summary),
    decisions: normalizeNoteList(analysis.decisions, 20),
    actionItems: normalizeNoteList(analysis.action_items, 30),
  };
}

/** The host's public booking page, for "suggest a next meeting", or null. */
export async function hostBookingSlug(db: Db, hostId: string): Promise<string | null> {
  try {
    const { data } = await db.from("scheduling_pages").select("slug").eq("user_id", hostId).limit(1).maybeSingle();
    const slug = (data as { slug?: unknown } | null)?.slug;
    return typeof slug === "string" && slug ? slug : null;
  } catch {
    return null;
  }
}
