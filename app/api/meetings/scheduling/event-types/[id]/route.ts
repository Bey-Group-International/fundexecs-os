// Update or remove one bookable meeting type. RLS scopes both to the owner.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { normalizeSlug } from "@/lib/meetings/scheduling";
import { serializeEventType } from "@/lib/meetings/scheduling-service";
import type { SchedulingEventType } from "@/lib/supabase/database.types";

export const runtime = "nodejs";

interface PatchBody {
  title?: string;
  slug?: string;
  description?: string | null;
  durationMinutes?: number;
  slotIntervalMinutes?: number;
  meetingType?: string;
  requiresApproval?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as PatchBody;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title) return NextResponse.json({ error: "Give the meeting type a name." }, { status: 422 });
      update.title = title.slice(0, 120);
    }
    if (body.slug !== undefined) {
      const slug = normalizeSlug(body.slug);
      if (!slug) return NextResponse.json({ error: "That link ending isn't usable." }, { status: 422 });
      update.slug = slug;
    }
    if (body.description !== undefined) update.description = body.description?.trim().slice(0, 1000) || null;
    if (body.durationMinutes !== undefined) {
      update.duration_minutes = Math.min(480, Math.max(5, Math.trunc(body.durationMinutes)));
    }
    if (body.slotIntervalMinutes !== undefined) {
      update.slot_interval_minutes = Math.min(240, Math.max(5, Math.trunc(body.slotIntervalMinutes)));
    }
    if (body.meetingType !== undefined) update.meeting_type = body.meetingType.trim() || "external_meeting";
    if (body.requiresApproval !== undefined) update.requires_approval = body.requiresApproval === true;
    if (body.isActive !== undefined) update.is_active = body.isActive === true;
    if (body.sortOrder !== undefined) update.sort_order = Math.max(0, Math.trunc(body.sortOrder));

    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("scheduling_event_types")
      .update(update as never)
      .eq("id", id)
      .eq("user_id", auth.ctx.userId)
      .select("*")
      .maybeSingle();
    if (error) {
      // The only unique index here is (page_id, slug).
      if (error.code === "23505") {
        return NextResponse.json({ error: "You already have a meeting type with that link ending." }, { status: 409 });
      }
      throw new Error(error.message);
    }
    if (!data) return NextResponse.json({ error: "Meeting type not found" }, { status: 404 });

    return NextResponse.json({ eventType: serializeEventType(data as unknown as SchedulingEventType) });
  } catch (err) {
    console.error("[/api/meetings/scheduling/event-types/[id]] PATCH", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update meeting type" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const supabase = await createServerClient();

    // Deleting cascades to this type's bookings, which would silently drop
    // meetings people are still expecting to attend. Retire it instead when any
    // upcoming booking is still live; the host can delete it once they're done.
    const { data: live } = await supabase
      .from("scheduling_bookings")
      .select("id")
      .eq("event_type_id", id)
      .in("status", ["pending", "confirmed"])
      .gte("ends_at", new Date().toISOString())
      .limit(1);

    if ((live ?? []).length > 0) {
      const { error } = await supabase
        .from("scheduling_event_types")
        .update({ is_active: false, updated_at: new Date().toISOString() } as never)
        .eq("id", id)
        .eq("user_id", auth.ctx.userId);
      if (error) throw new Error(error.message);
      return NextResponse.json({
        deleted: false,
        retired: true,
        message: "This type has upcoming bookings, so it was turned off instead of deleted.",
      });
    }

    const { error } = await supabase
      .from("scheduling_event_types")
      .delete()
      .eq("id", id)
      .eq("user_id", auth.ctx.userId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ deleted: true, retired: false });
  } catch (err) {
    console.error("[/api/meetings/scheduling/event-types/[id]] DELETE", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove meeting type" },
      { status: 500 },
    );
  }
}
