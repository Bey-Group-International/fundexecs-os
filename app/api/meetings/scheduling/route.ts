// Host-side scheduling link: read the member's booking page (creating it on
// first visit) and update its handle, hours and rules.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { SITE_URL } from "@/lib/site";
import {
  buildBookingPageUrl,
  isReservedSlug,
  isValidTime,
  mergeAvailability,
  normalizeSlug,
  parseAvailability,
  type SchedulingAvailabilityRule,
} from "@/lib/meetings/scheduling";
import {
  getOrCreatePageForUser,
  listBookingsForHost,
  slugTaken,
  serializeBooking,
  serializeEventType,
  serializeHostPage,
} from "@/lib/meetings/scheduling-service";
import type { Json } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  slug?: string;
  displayName?: string;
  headline?: string | null;
  bio?: string | null;
  timezone?: string;
  availability?: SchedulingAvailabilityRule[];
  bufferMinutes?: number;
  minNoticeMinutes?: number;
  bookingWindowDays?: number;
  isActive?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export async function GET() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const supabase = await createServerClient();
    const { page, eventTypes } = await getOrCreatePageForUser(supabase, {
      userId: auth.ctx.userId,
      orgId: auth.ctx.orgId,
      email: auth.ctx.email,
    });
    const bookings = await listBookingsForHost(supabase, auth.ctx.userId);

    return NextResponse.json({
      page: serializeHostPage(page),
      eventTypes: eventTypes.map(serializeEventType),
      bookings: bookings.map(serializeBooking),
      bookingUrl: buildBookingPageUrl(SITE_URL, page.slug),
    });
  } catch (err) {
    console.error("[/api/meetings/scheduling] GET", err);
    return NextResponse.json({ error: "Failed to load scheduling link" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = (await req.json().catch(() => ({}))) as PatchBody;
    const supabase = await createServerClient();
    const { page } = await getOrCreatePageForUser(supabase, {
      userId: auth.ctx.userId,
      orgId: auth.ctx.orgId,
      email: auth.ctx.email,
    });

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.slug !== undefined) {
      const slug = normalizeSlug(body.slug);
      if (!slug) return NextResponse.json({ error: "Choose a link ending with letters or numbers." }, { status: 422 });
      if (isReservedSlug(slug)) return NextResponse.json({ error: `"${slug}" is reserved. Pick another.` }, { status: 422 });
      // Handles are unique platform-wide, so a clash is the user's to resolve —
      // silently suffixing it would hand them a link they didn't ask for. The
      // probe runs service-role via slugTaken: this client only sees the
      // caller's own page under RLS, so it would report every other member's
      // handle as free and turn the 409 below into a 500 from the unique index.
      if (slug !== page.slug) {
        if (await slugTaken(supabase, slug, page.id)) {
          return NextResponse.json({ error: `"${slug}" is already taken.` }, { status: 409 });
        }
        update.slug = slug;
      }
    }

    if (body.displayName !== undefined) update.display_name = body.displayName.trim().slice(0, 120) || "FundExecs member";
    if (body.headline !== undefined) update.headline = body.headline?.trim().slice(0, 200) || null;
    if (body.bio !== undefined) update.bio = body.bio?.trim().slice(0, 1000) || null;
    if (body.timezone !== undefined) update.timezone = body.timezone.trim() || "UTC";
    if (body.bufferMinutes !== undefined) update.buffer_minutes = clamp(body.bufferMinutes, 0, 120);
    if (body.minNoticeMinutes !== undefined) update.min_notice_minutes = clamp(body.minNoticeMinutes, 0, 20160);
    if (body.bookingWindowDays !== undefined) update.booking_window_days = clamp(body.bookingWindowDays, 1, 365);
    if (body.isActive !== undefined) update.is_active = body.isActive === true;

    if (body.availability !== undefined) {
      if (!Array.isArray(body.availability)) {
        return NextResponse.json({ error: "Availability must be a list of windows." }, { status: 422 });
      }
      // Reject malformed windows loudly here (unlike the reader, which drops
      // them) so a bad hours edit never silently empties someone's calendar.
      for (const rule of body.availability) {
        if (!isValidTime(rule?.start) || !isValidTime(rule?.end) || rule.start >= rule.end) {
          return NextResponse.json({ error: "Each window needs a start time before its end time." }, { status: 422 });
        }
      }
      update.availability = mergeAvailability(parseAvailability(body.availability)) as unknown as Json;
    }

    const { data, error } = await supabase
      .from("scheduling_pages")
      .update(update as never)
      .eq("id", page.id)
      .select("*")
      .single();
    if (error) {
      // Lost the race between the probe and the UPDATE — same user-facing
      // outcome as the check above, never a leaked constraint name.
      if (error.code === "23505") {
        return NextResponse.json({ error: `"${update.slug}" is already taken.` }, { status: 409 });
      }
      throw new Error(error.message);
    }

    const saved = data as unknown as Parameters<typeof serializeHostPage>[0];
    return NextResponse.json({
      page: serializeHostPage(saved),
      bookingUrl: buildBookingPageUrl(SITE_URL, saved.slug),
    });
  } catch (err) {
    console.error("[/api/meetings/scheduling] PATCH", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update scheduling link" },
      { status: 500 },
    );
  }
}
