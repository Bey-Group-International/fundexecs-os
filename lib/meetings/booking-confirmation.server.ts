// lib/meetings/booking-confirmation.server.ts
// The confirmation an invitee gets after booking through a public link — and
// the retry that re-sends it when the first attempt reached nobody.
//
// That one email is everything a stranger has for their meeting: the join
// link, the manage link, the calendar invite. It fails whenever the host has no
// mailbox or the mail provider is refusing (as every org's did when the app's
// Google OAuth client was deleted), and nothing used to try again. Now the book
// route marks the booking, and the hourly cron re-sends the invitee's copy.
//
// Never throws: a confirmation is owed, but losing it must not fail a booking
// that has already been made, or abort the cron for everyone else.
import { SITE_URL } from "@/lib/site";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";
import { buildBookingManageUrl } from "@/lib/meetings/scheduling";
import { hostCredentials } from "@/lib/meetings/mailbox.server";
import { hostContactFor } from "@/lib/meetings/scheduling-host";
import { sendBookingEmails, type BookingEmailContext } from "@/lib/meetings/scheduling-email";
import { loadBookingById, type BookingContext } from "@/lib/meetings/scheduling-service";

// The same loosely-typed client the scheduling service takes.
type Client = Parameters<typeof loadBookingById>[0];

/**
 * Attempts before a confirmation is given up on. Hourly, so about two days:
 * long enough to ride out an outage, short of mailing a stranger about a
 * meeting they have long since forgotten booking.
 */
export const CONFIRMATION_RETRY_MAX_ATTEMPTS = 48;

/** Rows looked at per sweep. Almost none are ever flagged. */
const SWEEP_LIMIT = 50;

// The columns this module owns are not on the shared booking type, so its
// reads and writes go through an untyped handle on the table.
function bookings(client: Client) {
  return (client as unknown as { from: (t: string) => any }).from("scheduling_bookings");
}

/**
 * Send the confirmation for a booking made through a public link, and mark it
 * for a retry if the invitee's copy didn't go out.
 */
/**
 * The email context for a booking made through a public link.
 *
 * The invitee is anonymous, so there is no acting user to send as. The person
 * this is from is the host whose link was booked, so it goes out from their
 * mailbox; without one it falls back to the org's, because a booking email the
 * invitee never receives is worse than one from a shared address.
 */
export async function bookingEmailContext(
  client: Client,
  ctx: BookingContext,
  extra: Partial<BookingEmailContext> = {},
): Promise<BookingEmailContext> {
  const { booking, page, eventType, roomCode } = ctx;
  const host = await hostContactFor(client, page);
  return {
    credentials: await hostCredentials(client, page.user_id, page.organization_id ?? undefined),
    orgId: page.organization_id ?? undefined,
    eventTitle: eventType.title,
    hostName: page.display_name,
    hostEmail: host.email,
    inviteeName: booking.invitee_name,
    inviteeEmail: booking.invitee_email,
    inviteeTimezone: booking.invitee_timezone,
    hostTimezone: page.timezone,
    startIso: booking.starts_at,
    endIso: booking.ends_at,
    durationMinutes: eventType.duration_minutes,
    notes: booking.invitee_notes,
    joinUrl: roomCode ? buildMeetingInviteUrl(SITE_URL, roomCode) : null,
    manageUrl: buildBookingManageUrl(SITE_URL, booking.manage_token),
    manageToken: booking.manage_token,
    hostMeetingsUrl: `${SITE_URL}/meetings`,
    bookingId: booking.id,
    bookingCreatedAt: booking.created_at,
    bookingUpdatedAt: booking.updated_at,
    bookingSequence: booking.calendar_sequence,
    siteUrl: SITE_URL,
    ...extra,
  };
}

/**
 * Send the confirmation for a booking made through a public link, and mark it
 * for a retry if the invitee's copy didn't go out.
 */
export async function sendBookingConfirmation(
  client: Client,
  ctx: BookingContext,
  opts: { inviteeOnly?: boolean } = {},
): Promise<{ sent: number; inviteeSent: boolean }> {
  const { booking } = ctx;
  const kind = booking.status === "pending" ? "requested" : "confirmed";
  const context = await bookingEmailContext(client, ctx);
  const result = opts.inviteeOnly
    ? await sendBookingEmails(kind, context, { inviteeOnly: true })
    : await sendBookingEmails(kind, context);

  if (!result.inviteeSent && !opts.inviteeOnly) {
    try {
      const { error } = await bookings(client).update({ confirmation_email_pending: true }).eq("id", booking.id);
      if (error) console.error("[booking-confirmation] could not mark for retry", booking.id, error);
    } catch (err) {
      console.error("[booking-confirmation] could not mark for retry", booking.id, err);
    }
  }
  return result;
}

export interface ConfirmationRetryStats {
  /** Flagged bookings this sweep took on. */
  due: number;
  /** Confirmations that reached the invitee this time. */
  delivered: number;
  /** Ones that failed again (or could not be tried). */
  failed: number;
}

/**
 * Re-send every owed confirmation whose meeting is still ahead. Driven by the
 * hourly cron.
 *
 * Each row is claimed by moving its attempt count on from the value just read,
 * so two overlapping sweeps can never both mail the same stranger.
 */
export async function runBookingConfirmationRetries(
  client: Client,
  opts: { now?: Date } = {},
): Promise<ConfirmationRetryStats> {
  const now = opts.now ?? new Date();
  const stats: ConfirmationRetryStats = { due: 0, delivered: 0, failed: 0 };

  let rows: Array<{ id: string; confirmation_email_attempts: number }> = [];
  try {
    const { data, error } = await bookings(client)
      .select("id, confirmation_email_attempts")
      .eq("confirmation_email_pending", true)
      .in("status", ["pending", "confirmed"])
      .gt("starts_at", now.toISOString())
      .lt("confirmation_email_attempts", CONFIRMATION_RETRY_MAX_ATTEMPTS)
      .order("starts_at", { ascending: true })
      .limit(SWEEP_LIMIT);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as typeof rows;
  } catch (err) {
    console.error("[booking-confirmation] retry lookup failed", err);
    return stats;
  }

  for (const row of rows) {
    try {
      const attempt = row.confirmation_email_attempts + 1;
      const { data: claimed, error: claimError } = await bookings(client)
        .update({ confirmation_email_attempts: attempt })
        .eq("id", row.id)
        .eq("confirmation_email_attempts", row.confirmation_email_attempts)
        .select("id");
      if (claimError) throw new Error(claimError.message);
      // Another sweep got here first; its send is the one that happens.
      if (!claimed || claimed.length === 0) continue;
      stats.due += 1;

      const ctx = await loadBookingById(client, row.id);
      // Cancelled or declined since: there is nothing left to confirm.
      if (!ctx || (ctx.booking.status !== "confirmed" && ctx.booking.status !== "pending")) {
        await bookings(client).update({ confirmation_email_pending: false }).eq("id", row.id);
        continue;
      }

      const result = await sendBookingConfirmation(client, ctx, { inviteeOnly: true });
      if (result.inviteeSent) {
        stats.delivered += 1;
        await bookings(client).update({ confirmation_email_pending: false }).eq("id", row.id);
      } else {
        stats.failed += 1;
        if (attempt >= CONFIRMATION_RETRY_MAX_ATTEMPTS) {
          await bookings(client).update({ confirmation_email_pending: false }).eq("id", row.id);
        }
      }
    } catch (err) {
      stats.failed += 1;
      console.error("[booking-confirmation] retry failed", row.id, err);
    }
  }

  return stats;
}
