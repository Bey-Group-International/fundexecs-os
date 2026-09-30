// lib/meetings/booking-manage.ts
// What the invitee's manage page is given, as one type.
//
// Declared here, apart from the loader in booking-manage.server.ts, because
// three places need the shape and only one of them may touch a database: the
// server component that renders the page, the route that serves the same view to
// the browser, and the client component that draws it. Two copies of this
// interface would drift, and the drift would be silent — a field the page reads
// and the loader stopped sending reads as `undefined`, not as an error.
//
// Pure: types only, so a client component can import it without pulling a
// service-role Supabase client into the browser bundle.

import type { SlotWindow } from "@/lib/meetings/scheduling";

/** The one booking behind a manage token, and the times it could move to. */
export interface ManageBookingView {
  booking: {
    id: string;
    eventTitle: string | null;
    inviteeName: string;
    startsAt: string;
    endsAt: string;
    status: "pending" | "confirmed" | "declined" | "cancelled";
    cancelledBy: "host" | "invitee" | null;
    cancellationReason: string | null;
    inviteeTimezone: string;
  };
  page: { slug: string; displayName: string };
  eventType: { title: string; durationMinutes: number };
  joinUrl: string | null;
  bookingPageUrl: string;
  /**
   * The zone the host publishes their hours in. Sent because the payload has
   * always sent it; the page shows times in the invitee's own zone and so does
   * not read it.
   */
  hostTimezone: string;
  /** Empty for a booking that can no longer be moved. */
  slots: SlotWindow[];
}
