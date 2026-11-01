// lib/lp-reminders.server.ts
// The hourly sweep that reminds LPs who have gone quiet. Day 3 and day 6 of a
// 7-day link, from the fund manager's OWN connected mailbox only: no mailbox, no
// reminder, and no backup sender and no deployment-wide token standing in for
// one: an LP is never emailed in the name of a mailbox that isn't the fund
// manager's own.
//
// Each reminder is claimed (stamped) before it is sent, and only if nobody
// stamped it first, so overlapping sweeps never send it twice. A send that
// fails releases the claim so the next sweep tries again.
//
// Never throws: one bad row must not stop the rest, or the cron.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmailConfigStatus, sendEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import { dueReminder, reminderEmail, type ReminderDay } from "@/lib/lp-reminders";

type Client = SupabaseClient<any, any, any>;

/** Rows read per page, and pages per sweep. Most rows are not yet due. */
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export interface LpReminderStats {
  /** Reminders emailed this sweep. */
  reminded: number;
  /** Due, but the organization has no mailbox of its own connected. */
  noMailbox: number;
  /** Claimed or sent but failed; they will be tried again next sweep. */
  failed: number;
}

interface Row {
  id: string;
  organization_id: string;
  lp_name: string;
  lp_email: string;
  token: string;
  review_state: string;
  status: string;
  created_at: string;
  expires_at: string;
  reminded_day3_at: string | null;
  reminded_day6_at: string | null;
}

/**
 * LPs who might be due a reminder, oldest first, read a page at a time. Paging
 * matters: LPs of an organization with no mailbox are skipped but stay eligible,
 * and a single page of them would otherwise crowd newer LPs out of every sweep.
 * Never throws; a failed page ends the read with what was found so far.
 */
async function loadCandidates(client: Client, now: Date): Promise<Row[]> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      let q = client
        .from("lp_onboarding_sessions")
        .select("id, organization_id, lp_name, lp_email, token, review_state, status, created_at, expires_at, reminded_day3_at, reminded_day6_at")
        .in("review_state", ["not_started", "in_progress"])
        .neq("status", "expired")
        .gt("expires_at", now.toISOString())
        .lte("created_at", new Date(now.getTime() - 3 * 86_400_000).toISOString())
        .or("reminded_day3_at.is.null,reminded_day6_at.is.null");
      // The next page starts where this one ended. Rows sharing that exact
      // timestamp are read again and dropped below, so none is skipped.
      if (cursor) q = q.gte("created_at", cursor);
      const { data, error } = await q.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(PAGE_SIZE);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as Row[];
      const fresh = batch.filter((r) => !seen.has(r.id));
      fresh.forEach((r) => seen.add(r.id));
      rows.push(...fresh);
      if (batch.length < PAGE_SIZE || fresh.length === 0) break;
      cursor = batch[batch.length - 1].created_at;
    } catch (err) {
      console.error("[lp-reminders] lookup failed", err);
      break;
    }
  }
  return rows;
}

/** Gives a reminder's claim back so the next sweep tries again. Tried twice; a claim that can't be released is logged. */
async function releaseClaim(client: Client, id: string, stamp: string, columns: string[]): Promise<void> {
  const release = Object.fromEntries(columns.map((c) => [c, null]));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { error } = await client.from("lp_onboarding_sessions").update(release).eq("id", id).eq(columns[0], stamp);
      if (!error) return;
      if (attempt === 1) console.error("[lp-reminders] could not release the claim for", id, error.message);
    } catch (err) {
      if (attempt === 1) console.error("[lp-reminders] could not release the claim for", id, err);
    }
  }
}

export async function runLpReminders(client: Client, opts: { now?: Date } = {}): Promise<LpReminderStats> {
  const now = opts.now ?? new Date();
  const stats: LpReminderStats = { reminded: 0, noMailbox: 0, failed: 0 };

  const rows = await loadCandidates(client, now);

  const mailbox = new Map<string, boolean>();
  const orgNames = new Map<string, string>();
  const ownMailbox = async (orgId: string) => {
    if (!mailbox.has(orgId)) {
      try {
        // Only the organization's own connection counts. The deployment-wide
        // token is shared by every organization and is not used for this.
        const status = await getEmailConfigStatus(orgId);
        mailbox.set(orgId, status.source === "org-oauth" || status.source === "org-token");
      } catch {
        mailbox.set(orgId, false);
      }
    }
    return mailbox.get(orgId)!;
  };
  const orgName = async (orgId: string) => {
    if (!orgNames.has(orgId)) {
      const { data } = await client.from("organizations").select("name").eq("id", orgId).maybeSingle();
      orgNames.set(orgId, (data as { name?: string } | null)?.name ?? "your fund manager");
    }
    return orgNames.get(orgId)!;
  };

  for (const row of rows) {
    const day: ReminderDay | null = dueReminder(row, now.getTime());
    if (!day) continue;

    try {
      if (!(await ownMailbox(row.organization_id))) {
        stats.noMailbox += 1;
        continue;
      }

      // Claim it. The day-6 reminder also covers a day-3 that was never sent.
      const stamp = now.toISOString();
      const patch: Record<string, string> = { [`reminded_day${day}_at`]: stamp };
      if (day === 6 && !row.reminded_day3_at) patch.reminded_day3_at = stamp;
      const { data: claimed, error } = await client
        .from("lp_onboarding_sessions")
        .update(patch)
        .eq("id", row.id)
        .is(`reminded_day${day}_at`, null)
        .in("review_state", ["not_started", "in_progress"])
        .select("id");
      if (error) throw new Error(error.message);
      if (!claimed || claimed.length === 0) continue;

      const mail = reminderEmail({
        day,
        lpName: row.lp_name,
        orgName: await orgName(row.organization_id),
        url: `${getAppUrl()}/lp/${row.token}`,
        expiresAt: row.expires_at,
      });
      const result = await sendEmail({
        orgId: row.organization_id,
        to: { name: row.lp_name, email: row.lp_email },
        subject: mail.subject,
        htmlBody: mail.htmlBody,
        allowFallback: false,
      });
      if (result.ok) {
        stats.reminded += 1;
        continue;
      }

      // Not sent: give the claim back so the next sweep tries again.
      stats.failed += 1;
      await releaseClaim(client, row.id, stamp, patch.reminded_day3_at && day === 6 ? [`reminded_day6_at`, "reminded_day3_at"] : [`reminded_day${day}_at`]);
    } catch (err) {
      stats.failed += 1;
      console.error("[lp-reminders] could not remind", row.id, err);
    }
  }

  return stats;
}
