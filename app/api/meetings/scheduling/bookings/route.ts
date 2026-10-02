// The host's pending scheduling-link requests over a date window, for drawing
// on their own calendar. A request has no meeting room until it is approved, so
// the calendar's meetings read never sees it.
//
// Read with the host's own session: bookings are visible to their host under
// RLS, and this lists only theirs.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { listBookingsForHost, serializeBooking } from "@/lib/meetings/scheduling-service";

export const runtime = "nodejs";

/** Wider than the calendar's window ever is; a guard, not a page size. */
const MAX_REQUESTS = 200;

function isoOrNull(value: string | null): string | null {
  if (!value) return null;
  const at = new Date(value);
  return isNaN(at.getTime()) ? null : at.toISOString();
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = req.nextUrl;
    const from = isoOrNull(searchParams.get("from"));
    const to = isoOrNull(searchParams.get("to"));

    const supabase = await createServerClient();
    const bookings = await listBookingsForHost(supabase, auth.ctx.userId, {
      statuses: ["pending"],
      // Never earlier than now: a request whose time has passed is no longer
      // something to approve or move, and the expiry sweep closes it.
      fromIso: from && from > new Date().toISOString() ? from : undefined,
      toIso: to ?? undefined,
      limit: MAX_REQUESTS,
    });

    return NextResponse.json({ requests: bookings.map(serializeBooking) });
  } catch (err) {
    console.error("[/api/meetings/scheduling/bookings] GET", err);
    return NextResponse.json({ error: "Could not load booking requests." }, { status: 500 });
  }
}
