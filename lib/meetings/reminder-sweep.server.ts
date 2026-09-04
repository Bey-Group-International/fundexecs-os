// lib/meetings/reminder-sweep.server.ts
// The scheduled half of meeting reminders: find the meetings whose reminder is
// due and send it, across every organization, from the hourly cron.
//
// Runs service-role and unauthenticated, so it scopes nothing to a session and
// resolves each meeting's mailbox from its own host. Every decision about
// WHETHER to send lives in reminder.ts, where it is pure and testable; this
// module is the read, the send and the stamp.
//
// Never throws. A reminder is a courtesy — one org's revoked mailbox must not
// abort the sweep for everybody else.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { sendEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";
import { formatSlotFull } from "@/lib/meetings/scheduling";
import { hostCredentials } from "@/lib/meetings/mailbox.server";
import {
  buildReminderEmail,
  describeTimeUntil,
  dueReminders,
  reminderRecipients,
  REMINDER_SWEEP_LOOKAHEAD_MS,
  type SweepableMeeting,
} from "@/lib/meetings/reminder";

type ServiceClient = SupabaseClient<Database>;

export interface ReminderSweepStats {
  /** Meetings whose reminder came due on this sweep. */
  due: number;
  /** Meetings for which at least one recipient was reached. */
  reminded: number;
  /** Individual emails delivered. */
  sent: number;
  /** Meetings where every recipient failed — usually an unconnected mailbox. */
  failed: number;
}

const SELECT =
  "id, organization_id, host_id, title, status, scheduled_at, duration_minutes, timezone, is_draft, deleted_at, attendees, room_code, meeting_url, reminder_minutes, last_reminder_sent_at";

/**
 * The widest reminder the sweep will look ahead for.
 *
 * The schedule screen offers minutes-to-a-day; this is deliberately roomier so
 * a hand-set value is not silently ignored, while still bounding the read.
 */
const MAX_LEAD_MS = 8 * 24 * 3600_000;

/**
 * Send every reminder that has come due.
 *
 * Ordering note: the row is stamped BEFORE the send. A reminder that goes out
 * twice is worse than one that goes out never — these land in external
 * inboxes — so a crash between the two costs one reminder rather than mailing
 * a guest list again on the next sweep.
 */
export async function runMeetingReminders(
  supabase: ServiceClient,
  opts: { now?: Date; limit?: number; lookaheadMs?: number } = {},
): Promise<ReminderSweepStats> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 50;
  const stats: ReminderSweepStats = { due: 0, reminded: 0, sent: 0, failed: 0 };

  const { data, error } = await supabase
    .from("live_meetings")
    .select(SELECT)
    .eq("is_draft", false)
    .is("deleted_at", null)
    .is("last_reminder_sent_at", null)
    .neq("status", "ended")
    .not("reminder_minutes", "is", null)
    .gt("scheduled_at", now.toISOString())
    .lte("scheduled_at", new Date(now.getTime() + MAX_LEAD_MS).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit * 4);
  if (error) return stats;

  const due = dueReminders(
    (data ?? []) as unknown as SweepableMeeting[],
    now,
    opts.lookaheadMs ?? REMINDER_SWEEP_LOOKAHEAD_MS,
  ).slice(0, limit);
  stats.due = due.length;

  for (const meeting of due) {
    try {
      const claimed = await claim(supabase, meeting.id, now);
      // Another sweep running concurrently got there first. Its send is the
      // one that happens; this one does nothing rather than double up.
      if (!claimed) {
        stats.due -= 1;
        continue;
      }

      const sent = await remind(supabase, meeting, now);
      stats.sent += sent;
      if (sent > 0) stats.reminded += 1;
      else stats.failed += 1;
    } catch (err) {
      stats.failed += 1;
      console.error("[meetings/reminder-sweep] reminder failed", meeting.id, err);
    }
  }

  return stats;
}

/**
 * Take this meeting's reminder, or report that somebody else already has.
 *
 * The `is("last_reminder_sent_at", null)` in the UPDATE is what makes this a
 * claim rather than a write: two overlapping sweeps both selected the row, and
 * only the one whose update matches an unstamped row may send.
 */
async function claim(supabase: ServiceClient, id: string, now: Date): Promise<boolean> {
  const { data, error } = await supabase
    .from("live_meetings")
    .update({ last_reminder_sent_at: now.toISOString() })
    .eq("id", id)
    .is("last_reminder_sent_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Email one meeting's reminder. Returns how many recipients were reached. */
async function remind(supabase: ServiceClient, meeting: SweepableMeeting, now: Date): Promise<number> {
  const recipients = reminderRecipients(meeting.attendees);
  if (recipients.length === 0) return 0;

  const orgId = meeting.organization_id ?? undefined;
  const credentials = await hostCredentials(supabase, meeting.host_id, orgId);
  const joinUrl = meeting.room_code
    ? buildMeetingInviteUrl(SITE_URL, meeting.room_code)
    : meeting.meeting_url ?? null;

  const { subject, html } = buildReminderEmail({
    title: meeting.title ?? "your meeting",
    // The sweep has no acting user — nobody pressed anything. The meeting is
    // the sender, and saying so is better than naming a host who is asleep.
    hostName: "FundExecs OS",
    whenLabel: formatSlotFull(meeting.scheduled_at!, meeting.timezone || "UTC"),
    timeUntil: describeTimeUntil(meeting.scheduled_at!, now),
    joinUrl,
  });

  const results = await Promise.allSettled(
    recipients.map((r) =>
      sendEmail({ orgId, credentials, to: r, subject, htmlBody: html }),
    ),
  );

  return results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
}
