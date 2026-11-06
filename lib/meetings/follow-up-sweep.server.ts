// lib/meetings/follow-up-sweep.server.ts
// The follow-up's hourly work, run from /api/cron:
//
//   1. Scheduled follow-ups whose time has come are sent from the host's
//      mailbox, and recorded exactly as an immediate send is.
//   2. Sent follow-ups nobody has answered within their nudge window get one
//      short nudge on the same subject — or, where the firm approves outbound
//      email first, a task for the host to nudge them instead.
//   3. Overdue action items from meetings are chased with their owner: every
//      three days, three times at most.
//
// Bounded per pass and never throws: one bad row costs that row, not the sweep.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { sendEmail } from "@/lib/email";
import { gateDecision } from "@/lib/gates";
import { getActiveMandateForOrg } from "@/lib/mandates";
import { followUpHtml } from "@/lib/meetings/follow-up";
import { chaseDue, chaseEmail, nudgeDue, nudgeEmail, type SendRow } from "@/lib/meetings/follow-up-loop";
import { repliesSince, SEND_COLUMNS } from "@/lib/meetings/follow-up-sends.server";
import { recordFollowUpThreads } from "@/lib/meetings/follow-up-threads.server";
import { mailboxFor } from "@/lib/meetings/mailbox.server";
import { mailboxProblemMessage } from "@/lib/meetings/mailbox";
import { createTeamTask } from "@/lib/team-tasks";
import { SITE_URL } from "@/lib/site";

type Service = SupabaseClient<Database>;
type Db = { from: (table: string) => any };

export interface FollowUpSweepStats {
  scheduledSent: number;
  scheduledFailed: number;
  nudged: number;
  nudgeTasks: number;
  chased: number;
}

const MAX_SCHEDULED = 50;
const MAX_NUDGES = 50;
const MAX_CHASES = 50;

type Row = SendRow & { meeting_id: string; organization_id: string; created_by: string | null; subject: string; body: string };

async function hostName(db: Db, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await db.from("principals").select("full_name").eq("id", userId).maybeSingle();
  return ((data as { full_name?: string | null } | null)?.full_name ?? null) || null;
}

/** Whether this firm sends outbound replies without an approval step. */
async function sendsWithoutApproval(service: Service, orgId: string, cache: Map<string, boolean>): Promise<boolean> {
  const known = cache.get(orgId);
  if (known !== undefined) return known;
  let free = false;
  try {
    const mandate = await getActiveMandateForOrg(service, orgId);
    free = !gateDecision("send_reply", mandate).requiresApproval;
  } catch {
    free = false;
  }
  cache.set(orgId, free);
  return free;
}

async function mark(db: Db, id: string, patch: Record<string, unknown>) {
  await db.from("live_meeting_followup_sends").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

async function runScheduled(service: Service, now: Date, stats: FollowUpSweepStats, gates: Map<string, boolean>) {
  const db = service as unknown as Db;
  const { data, error } = await db
    .from("live_meeting_followup_sends")
    .select(`${SEND_COLUMNS}, meeting_id, organization_id, created_by, subject, body`)
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(MAX_SCHEDULED);
  if (error || !Array.isArray(data) || !data.length) return;

  // One mailbox lookup per sender, one thread record per meeting.
  const byMeeting = new Map<string, Row[]>();
  for (const row of data as Row[]) byMeeting.set(row.meeting_id, [...(byMeeting.get(row.meeting_id) ?? []), row]);

  for (const [meetingId, rows] of byMeeting) {
    const first = rows[0];
    if (!first.created_by) {
      for (const r of rows) await mark(db, r.id, { status: "failed", error: "No sender for this scheduled follow-up." });
      stats.scheduledFailed += rows.length;
      continue;
    }
    if (!(await sendsWithoutApproval(service, first.organization_id, gates))) {
      for (const r of rows) {
        await mark(db, r.id, { status: "failed", error: "Your firm now approves outbound email first. Draft it in the inbox instead." });
      }
      stats.scheduledFailed += rows.length;
      continue;
    }
    const mailbox = await mailboxFor(service, first.created_by, first.organization_id).catch(() => null);
    if (!mailbox || !mailbox.ok) {
      const reason = mailbox && !mailbox.ok ? mailboxProblemMessage(mailbox.problem) : "No connected mailbox to send from.";
      for (const r of rows) await mark(db, r.id, { status: "failed", error: reason.slice(0, 300) });
      stats.scheduledFailed += rows.length;
      continue;
    }
    const results = await Promise.allSettled(
      rows.map((r) =>
        sendEmail({
          orgId: r.organization_id,
          credentials: { gmailAccessToken: mailbox.token },
          to: { name: r.name ?? r.email, email: r.email },
          subject: r.subject,
          htmlBody: followUpHtml(r.body),
        }),
      ),
    );
    const sentAt = new Date().toISOString();
    for (let i = 0; i < rows.length; i++) {
      const res = results[i];
      const value = res.status === "fulfilled" ? (res.value as { ok?: boolean; detail?: string }) : null;
      if (value?.ok) {
        await mark(db, rows[i].id, { status: "sent", sent_at: sentAt, error: null });
        stats.scheduledSent += 1;
      } else {
        const why = value?.detail ?? (res.status === "rejected" ? String(res.reason) : "Not delivered");
        await mark(db, rows[i].id, { status: "failed", error: why.slice(0, 300) });
        stats.scheduledFailed += 1;
      }
    }
    try {
      await recordFollowUpThreads(service, {
        orgId: first.organization_id,
        meetingId,
        hostId: first.created_by,
        hostName: await hostName(db, first.created_by),
        subject: first.subject,
        mailbox: { source: mailbox.source, email: mailbox.email },
        sends: rows.map((r, i) => ({ recipient: { name: r.name ?? r.email, email: r.email }, body: r.body, result: results[i] as never })),
      });
    } catch (err) {
      console.warn("[follow-up-sweep] could not record threads", err);
    }
    if (results.every((r) => r.status === "fulfilled" && (r.value as { ok?: boolean }).ok)) {
      await db.from("live_meetings").update({ followup_status: "done" }).eq("id", meetingId);
    }
  }
}

async function runNudges(service: Service, now: Date, stats: FollowUpSweepStats, gates: Map<string, boolean>) {
  const db = service as unknown as Db;
  const { data, error } = await db
    .from("live_meeting_followup_sends")
    .select(`${SEND_COLUMNS}, meeting_id, organization_id, created_by, subject, body`)
    .eq("status", "sent")
    .not("nudge_after_days", "is", null)
    .is("nudged_at", null)
    .is("replied_at", null)
    .lte("sent_at", new Date(now.getTime() - 86_400_000).toISOString())
    .order("sent_at", { ascending: true })
    .limit(MAX_NUDGES);
  if (error || !Array.isArray(data)) return;
  const due = (data as Row[]).filter((r) => nudgeDue(r, now.getTime()));
  if (!due.length) return;

  // Anyone who has answered since is left alone, and marked so.
  const byMeeting = new Map<string, Row[]>();
  for (const row of due) byMeeting.set(row.meeting_id, [...(byMeeting.get(row.meeting_id) ?? []), row]);
  for (const [meetingId, rows] of byMeeting) {
    const replies = await repliesSince(db, meetingId, new Map(rows.map((r) => [r.email.toLowerCase(), r.sent_at as string])));
    for (const r of rows) {
      const replied = replies.get(r.email.toLowerCase());
      if (replied) {
        await mark(db, r.id, { replied_at: replied });
        continue;
      }
      if (!r.created_by) continue;
      const name = await hostName(db, r.created_by);
      if (!(await sendsWithoutApproval(service, r.organization_id, gates))) {
        // The firm approves outbound email first: a person does the nudge.
        await createTeamTask(service, {
          organizationId: r.organization_id,
          assignedTo: r.created_by,
          assignedBy: r.created_by,
          title: `Nudge ${r.name ?? r.email} — no reply to your follow-up`,
          description: `No reply to "${r.subject}" after ${r.nudge_after_days} days.`,
          hub: "execute",
          module: "live_meetings",
          priority: "normal",
          meetingId,
        });
        await mark(db, r.id, { nudged_at: now.toISOString() });
        stats.nudgeTasks += 1;
        continue;
      }
      const mailbox = await mailboxFor(service, r.created_by, r.organization_id).catch(() => null);
      if (!mailbox || !mailbox.ok) continue;
      const nudge = nudgeEmail({ name: r.name, subject: r.subject, hostName: name });
      const result = await sendEmail({
        orgId: r.organization_id,
        credentials: { gmailAccessToken: mailbox.token },
        to: { name: r.name ?? r.email, email: r.email },
        subject: nudge.subject,
        htmlBody: followUpHtml(nudge.body),
      }).catch(() => null);
      if (result?.ok) {
        await mark(db, r.id, { nudged_at: now.toISOString() });
        stats.nudged += 1;
      }
    }
  }
}

async function runChases(service: Service, now: Date, stats: FollowUpSweepStats) {
  const db = service as unknown as Db;
  const { data, error } = await db
    .from("team_tasks")
    .select("id, organization_id, assigned_to, title, status, due_at, chased_at, chase_count, meeting_id")
    .not("meeting_id", "is", null)
    .in("status", ["pending", "in_progress", "blocked"])
    .lte("due_at", now.toISOString())
    .lt("chase_count", 3)
    .order("due_at", { ascending: true })
    .limit(MAX_CHASES);
  // Before the migration chase_count is missing (42703) and nothing is chased.
  if (error || !Array.isArray(data)) return;
  type Task = { id: string; organization_id: string; assigned_to: string; title: string; status: string; due_at: string; chased_at: string | null; chase_count: number | null; meeting_id: string };
  for (const task of (data as Task[]).filter((t) => chaseDue(t, now.getTime()))) {
    try {
      const [{ data: owner }, { data: meeting }] = await Promise.all([
        db.from("principals").select("full_name, email").eq("id", task.assigned_to).maybeSingle(),
        db.from("live_meetings").select("title, room_code").eq("id", task.meeting_id).maybeSingle(),
      ]);
      const email = (owner as { email?: string | null } | null)?.email;
      if (!email) continue;
      const room = (meeting as { room_code?: string | null } | null)?.room_code;
      const message = chaseEmail({
        ownerName: (owner as { full_name?: string | null }).full_name ?? null,
        title: task.title,
        meetingTitle: (meeting as { title?: string | null } | null)?.title ?? null,
        dueAt: task.due_at,
        link: room ? `${SITE_URL}/meetings/${room}/report#action-items` : `${SITE_URL}/meetings`,
      });
      const result = await sendEmail({
        orgId: task.organization_id,
        to: { name: (owner as { full_name?: string | null }).full_name ?? email, email },
        subject: message.subject,
        htmlBody: followUpHtml(message.body),
      }).catch(() => null);
      // Counted either way: an owner with no reachable mailbox is not retried hourly.
      await db
        .from("team_tasks")
        .update({ chased_at: now.toISOString(), chase_count: (task.chase_count ?? 0) + 1 })
        .eq("id", task.id);
      if (result?.ok) stats.chased += 1;
    } catch (err) {
      console.warn("[follow-up-sweep] chase failed", err);
    }
  }
}

export async function runFollowUpSweep(service: Service, opts: { now?: Date } = {}): Promise<FollowUpSweepStats> {
  const now = opts.now ?? new Date();
  const stats: FollowUpSweepStats = { scheduledSent: 0, scheduledFailed: 0, nudged: 0, nudgeTasks: 0, chased: 0 };
  const gates = new Map<string, boolean>();
  for (const step of [runScheduled, runNudges] as const) {
    try {
      await step(service, now, stats, gates);
    } catch (err) {
      console.error(`[follow-up-sweep] ${step.name} failed`, err);
    }
  }
  try {
    await runChases(service, now, stats);
  } catch (err) {
    console.error("[follow-up-sweep] runChases failed", err);
  }
  return stats;
}
