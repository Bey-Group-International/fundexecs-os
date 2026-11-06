// app/api/meetings/[id]/follow-up/status/route.ts
// Where the follow-up stands, person by person: scheduled, sent, failed (and
// why), nudged or replied — plus the host's booking link, for suggesting the
// next meeting in the email.
import { NextRequest, NextResponse } from "next/server";
import { deliveryLines } from "@/lib/meetings/follow-up-loop";
import { hostBookingSlug, loadSends } from "@/lib/meetings/follow-up-sends.server";
import { buildBookingPageUrl } from "@/lib/meetings/scheduling";
import { SITE_URL } from "@/lib/site";
import { requireMeetingHost } from "../host.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireMeetingHost(id);
  if (!access.ok) return access.response;
  const [{ rows, available }, slug] = await Promise.all([loadSends(access.db, id), hostBookingSlug(access.db, access.userId)]);
  return NextResponse.json({
    available,
    lines: deliveryLines(rows),
    bookingUrl: slug ? buildBookingPageUrl(SITE_URL, slug) : null,
    hostEmail: access.email,
  });
}
