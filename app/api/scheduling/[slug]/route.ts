// Public lookup of a booking page by its handle. Anonymous: the invitee has no
// FundExecs account, so this runs service-role and returns only what the
// booking page renders — never the host's identity, org, or internal state.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { resolvePublicPage, serializeEventType, serializePublicPage } from "@/lib/meetings/scheduling-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (!hasSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Scheduling is not configured on this deployment." }, { status: 503 });
    }
    const { slug } = await params;
    const resolved = await resolvePublicPage(createServiceClient(), slug);
    if (!resolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({
      page: serializePublicPage(resolved.page),
      eventTypes: resolved.eventTypes.map((t) => {
        const { meetingType: _meetingType, isActive: _isActive, sortOrder: _sortOrder, ...publicFields } =
          serializeEventType(t);
        return publicFields;
      }),
    });
  } catch (err) {
    console.error("[/api/scheduling/[slug]] GET", err);
    return NextResponse.json({ error: "Failed to load booking page" }, { status: 500 });
  }
}
