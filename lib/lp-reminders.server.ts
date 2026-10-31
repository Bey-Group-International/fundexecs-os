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

/** Rows looked at per sweep. Most are not yet due. */
const SWEEP_LIMIT = 100;

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

export async function runLpReminders(client: Client, opts: { now?: Date } = {}): Promise<LpReminderStats> {
  const now = opts.now ?? new Date();
  const stats: LpReminderStats = { reminded: 0, noMailbox: 0, failed: 0 };

  let rows: Row[] = [];
  try {
    const { data, error } = await client
      .from("lp_onboarding_sessions")
      .select("id, organization_id, lp_name, lp_email, token, review_state, status, created_at, expires_at, reminded_day3_at, reminded_day6_at")
      .in("review_state", ["not_started", "in_progress"])
      .neq("status", "expired")
      .gt("expires_at", now.toISOString())
      .lte("created_at", new Date(now.getTime() - 3 * 86_400_000).toISOString())
      .or("reminded_day3_at.is.null,reminded_day6_at.is.null")
      .order("created_at", { ascending: true })
      .limit(SWEEP_LIMIT);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as Row[];
  } catch (err) {
    console.error("[lp-reminders] lookup failed", err);
    return stats;
  }

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
      const release: Record<string, null> = { [`reminded_day${day}_at`]: null };
      if (patch.reminded_day3_at) release.reminded_day3_at = null;
      await client.from("lp_onboarding_sessions").update(release).eq("id", row.id).eq(`reminded_day${day}_at`, stamp);
    } catch (err) {
      stats.failed += 1;
      console.error("[lp-reminders] could not remind", row.id, err);
    }
  }

  return stats;
}
