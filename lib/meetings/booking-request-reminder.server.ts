// lib/meetings/booking-request-reminder.server.ts
// Reminding a host about a booking request that is still waiting on them.
//
// A request on an approval-gated event type waits for the host. The request
// email went out when it arrived, but that is easy to miss, and a request
// nobody answers is declined automatically once its time comes (see
// booking-expiry.server.ts). This is the step before that: once, when the
// requested time is under a day away, the host is told the request is still
// open so they can answer while there is time.
//
// Never throws: one bad row must not stop the rest, or the cron.
import { sendBookingEmails } from "@/lib/meetings/scheduling-email";
import { loadBookingById } from "@/lib/meetings/scheduling-service";
import { bookingEmailContext } from "@/lib/meetings/booking-confirmation.server";

type Client = Parameters<typeof loadBookingById>[0];

/** How far ahead of the requested time the host is reminded. */
export const REQUEST_REMINDER_LEAD_MS = 24 * 3600_000;

/** Rows looked at per sweep. Almost none are ever due. */
const SWEEP_LIMIT = 50;

export interface RequestReminderStats {
  /** Requests whose host was reminded this sweep. */
  reminded: number;
  /** Rows that could not be claimed, loaded or emailed. */
  failed: number;
}

function bookings(client: Client) {
  return (client as unknown as { from: (t: string) => any }).from("scheduling_bookings");
}

export async function runBookingRequestReminders(
  client: Client,
  opts: { now?: Date } = {},
): Promise<RequestReminderStats> {
  const now = opts.now ?? new Date();
  const stats: RequestReminderStats = { reminded: 0, failed: 0 };

  let rows: Array<{ id: string }> = [];
  try {
    const { data, error } = await bookings(client)
      .select("id")
      .eq("status", "pending")
      .is("host_reminded_at", null)
      .gt("starts_at", now.toISOString())
      .lte("starts_at", new Date(now.getTime() + REQUEST_REMINDER_LEAD_MS).toISOString())
      .order("starts_at", { ascending: true })
      .limit(SWEEP_LIMIT);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as typeof rows;
  } catch (err) {
    console.error("[booking-request-reminder] lookup failed", err);
    return stats;
  }

  for (const row of rows) {
    try {
      // Stamped before sending, and only if nobody stamped it first, so two
      // overlapping sweeps never both email the host. A send that then fails
      // is not retried: one missed nudge is better than a host emailed hourly.
      const { data: claimed, error } = await bookings(client)
        .update({ host_reminded_at: now.toISOString() })
        .eq("id", row.id)
        .is("host_reminded_at", null)
        .eq("status", "pending")
        .select("id");
      if (error) throw new Error(error.message);
      if (!claimed || claimed.length === 0) continue;

      const ctx = await loadBookingById(client, row.id);
      if (!ctx || ctx.booking.status !== "pending") continue;

      const result = await sendBookingEmails("request_reminder", await bookingEmailContext(client, ctx));
      if (result.sent > 0) stats.reminded += 1;
      else stats.failed += 1;
    } catch (err) {
      stats.failed += 1;
      console.error("[booking-request-reminder] could not remind for", row.id, err);
    }
  }

  return stats;
}
