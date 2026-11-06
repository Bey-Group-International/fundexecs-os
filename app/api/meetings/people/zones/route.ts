import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadAttendeeZones } from "@/lib/meetings/attendee-zones.server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/meetings/people/zones?emails=a@x,b@y`
 *
 * The zone each guest is probably in, for the schedule form's "3:00 PM in
 * London" line. Org-scoped and read on the caller's own client, so it can
 * never say more than RLS already lets the member see.
 */
export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const emails = (req.nextUrl.searchParams.get("emails") ?? "").split(",");
  const supabase = await createServerClient();
  return NextResponse.json({ zones: await loadAttendeeZones(supabase, auth.ctx.orgId, emails) });
}
