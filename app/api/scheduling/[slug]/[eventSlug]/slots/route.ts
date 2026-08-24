// Open slots for one bookable meeting type. Public and anonymous: the response
// is a list of instants and nothing else — it never reveals what the host is
// busy with, only that a time isn't offered.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { openSlots, resolvePublicPage, serializeEventType } from "@/lib/meetings/scheduling-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; eventSlug: string }> },
) {
  try {
    if (!hasSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Scheduling is not configured on this deployment." }, { status: 503 });
    }
    const { slug, eventSlug } = await params;
    const service = createServiceClient();
    const resolved = await resolvePublicPage(service, slug);
    if (!resolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const eventType = resolved.eventTypes.find((t) => t.slug === eventSlug);
    if (!eventType) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { searchParams } = req.nextUrl;
    const from = searchParams.get("fromDate");
    const to = searchParams.get("toDate");

    const result = await openSlots(service, resolved.page, eventType, {
      fromDate: from && DATE_RE.test(from) ? from : null,
      toDate: to && DATE_RE.test(to) ? to : null,
    });

    const { meetingType: _meetingType, isActive: _isActive, sortOrder: _sortOrder, ...publicEventType } =
      serializeEventType(eventType);

    return NextResponse.json({
      eventType: publicEventType,
      hostTimezone: result.timezone,
      fromDate: result.fromDate,
      toDate: result.toDate,
      slots: result.slots,
    });
  } catch (err) {
    console.error("[/api/scheduling/[slug]/[eventSlug]/slots] GET", err);
    return NextResponse.json({ error: "Failed to load available times" }, { status: 500 });
  }
}
