// Create a bookable meeting type on the host's scheduling page.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { normalizeSlug } from "@/lib/meetings/scheduling";
import { getOrCreatePageForUser, serializeEventType } from "@/lib/meetings/scheduling-service";
import type { SchedulingEventType } from "@/lib/supabase/database.types";

export const runtime = "nodejs";

interface CreateBody {
  title?: string;
  slug?: string;
  description?: string | null;
  durationMinutes?: number;
  slotIntervalMinutes?: number;
  meetingType?: string;
  requiresApproval?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = (await req.json().catch(() => ({}))) as CreateBody;
    const title = body.title?.trim();
    if (!title) return NextResponse.json({ error: "Give the meeting type a name." }, { status: 422 });

    const supabase = await createServerClient();
    const { page, eventTypes } = await getOrCreatePageForUser(supabase, {
      userId: auth.ctx.userId,
      orgId: auth.ctx.orgId,
      email: auth.ctx.email,
    });

    const duration = Math.min(480, Math.max(5, Math.trunc(body.durationMinutes ?? 30)));
    // Slug is scoped to the page, so a suffix on collision is invisible to the
    // host and keeps "30 minute meeting" creatable twice without an error.
    const base = normalizeSlug(body.slug || title) || `meeting-${duration}`;
    const taken = new Set(eventTypes.map((t) => t.slug));
    let slug = base;
    for (let i = 2; taken.has(slug) && i < 100; i++) slug = `${base}-${i}`;

    const { data, error } = await supabase
      .from("scheduling_event_types")
      .insert({
        page_id: page.id,
        user_id: auth.ctx.userId,
        organization_id: auth.ctx.orgId,
        slug,
        title: title.slice(0, 120),
        description: body.description?.trim().slice(0, 1000) || null,
        duration_minutes: duration,
        slot_interval_minutes: Math.min(240, Math.max(5, Math.trunc(body.slotIntervalMinutes ?? 15))),
        meeting_type: body.meetingType?.trim() || "external_meeting",
        requires_approval: body.requiresApproval === true,
        sort_order: eventTypes.length,
      } as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ eventType: serializeEventType(data as unknown as SchedulingEventType) });
  } catch (err) {
    console.error("[/api/meetings/scheduling/event-types] POST", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create meeting type" },
      { status: 500 },
    );
  }
}
