// lib/meetings/booking-expiry.server.ts
// Closing booking requests the host never answered.
//
// An event type that requires approval turns a booking into a request, and a
// request waits on the host. When the host never decides, the time arrives
// and passes with the request still "pending": it drops off the host's list
// (which only shows what is still ahead), the invitee's manage page keeps
// saying "Waiting on the host" about a meeting that is already over, and
// nobody ever tells the person who asked.
//
// The hourly cron closes each one once its start time has come: declined,
// with a reason that says what happened, and the invitee is told so they can
// pick another time. Requests that expired long ago are closed without an
// email, since a note about a meeting weeks gone helps nobody.
//
// Never throws: one bad row must not stop the rest, or the cron.
import { sendBookingEmails } from "@/lib/meetings/scheduling-email";
import { buildBookingPageUrl } from "@/lib/meetings/scheduling";
import { SITE_URL } from "@/lib/site";
import { loadBookingById } from "@/lib/meetings/scheduling-service";
import { bookingEmailContext } from "@/lib/meetings/booking-confirmation.server";

type Client = Parameters<typeof loadBookingById>[0];

/** What the invitee is told, and what the booking records. */
export const EXPIRED_REQUEST_REASON = "The host didn't confirm this time before it started.";

/** Past this, a request is closed without emailing anyone. */
export const EXPIRY_NOTICE_WINDOW_MS = 48 * 3600_000;

/** Rows looked at per sweep. Almost none are ever due. */
const SWEEP_LIMIT = 50;

export interface RequestExpiryStats {
  /** Requests closed this sweep. */
  expired: number;
  /** Invitees told their request lapsed. */
  notified: number;
  /** Rows that could not be closed or whose email failed. */
  failed: number;
}

function bookings(client: Client) {
  return (client as unknown as { from: (t: string) => any }).from("scheduling_bookings");
}

export async function runBookingRequestExpiry(
  client: Client,
  opts: { now?: Date } = {},
): Promise<RequestExpiryStats> {
  const now = opts.now ?? new Date();
  const stats: RequestExpiryStats = { expired: 0, notified: 0, failed: 0 };

  let rows: Array<{ id: string; starts_at: string }> = [];
  try {
    const { data, error } = await bookings(client)
      .select("id, starts_at")
      .eq("status", "pending")
      .lte("starts_at", now.toISOString())
      .order("starts_at", { ascending: false })
      .limit(SWEEP_LIMIT);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as typeof rows;
  } catch (err) {
    console.error("[booking-expiry] lookup failed", err);
    return stats;
  }

  for (const row of rows) {
    try {
      // Closed only if still pending, so a host who approves in the same
      // moment wins, and two overlapping sweeps never both email the invitee.
      const { data: closed, error } = await bookings(client)
        .update({
          status: "declined",
          cancellation_reason: EXPIRED_REQUEST_REASON,
          decided_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id");
      if (error) throw new Error(error.message);
      if (!closed || closed.length === 0) continue;
      stats.expired += 1;

      if (now.getTime() - new Date(row.starts_at).getTime() > EXPIRY_NOTICE_WINDOW_MS) continue;

      const ctx = await loadBookingById(client, row.id);
      if (!ctx) continue;
      const context = await bookingEmailContext(client, ctx, {
        reason: EXPIRED_REQUEST_REASON,
        // A closed request has nothing to manage; the invitee gets the booking
        // page back to pick another time, as a host's decline sends.
        manageUrl: buildBookingPageUrl(SITE_URL, ctx.page.slug),
        manageToken: null,
      });
      const result = await sendBookingEmails("declined", context, { inviteeOnly: true });
      if (result.inviteeSent) stats.notified += 1;
      else stats.failed += 1;
    } catch (err) {
      stats.failed += 1;
      console.error("[booking-expiry] could not close", row.id, err);
    }
  }

  return stats;
}
