// A member's calendar layers, and the events inside them.
//
// GET  — the layer list for the sidebar (connected Google calendars plus
//        subscribed ICS feeds), and the external events in a window.
// PATCH — toggle a layer's visibility, or whether it counts against
//        availability.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { connectionHealth } from "@/lib/calendar/google";
import { feedHealth } from "@/lib/calendar/feeds";
import { googleOAuthConfigured } from "@/lib/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A window wider than this is a client bug, not a request worth serving. */
const MAX_WINDOW_DAYS = 400;
/** Ceiling on events returned. A month view draws far fewer than this. */
const MAX_EVENTS = 2000;

export interface CalendarLayer {
  id: string;
  source: "google" | "ics";
  name: string;
  color: string | null;
  isVisible: boolean;
  blocksAvailability: boolean;
  isPrimary: boolean;
  /** Whether write-back is possible. Reader-level calendars can never take a push. */
  canWrite: boolean;
  health: { state: string; message: string | null };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const window = parseWindow(req.nextUrl.searchParams);
    if (!window.ok) return NextResponse.json({ error: window.error }, { status: 422 });

    const supabase = await createServerClient();
    const userId = auth.ctx.userId;

    const [connection, calendars, feeds] = await Promise.all([
      supabase
        .from("google_calendar_connections")
        .select("google_email, last_sync_at, last_error, consecutive_failures")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("google_calendars")
        .select(
          "id, summary, background_color, is_visible, blocks_availability, is_primary, access_role, last_synced_at",
        )
        .eq("user_id", userId)
        .order("is_primary", { ascending: false })
        .order("summary", { ascending: true }),
      supabase
        .from("calendar_feeds")
        .select("id, label, is_active, last_success_at, last_error, consecutive_failures")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
    ]);

    const conn = connection.data as
      | { google_email: string | null; last_sync_at: string | null; last_error: string | null; consecutive_failures: number }
      | null;

    // One health verdict for the whole Google connection: a revoked grant
    // breaks every calendar under it at once, and repeating that on each row
    // would read as many separate problems rather than one.
    const googleHealth = conn
      ? connectionHealth({
          lastSyncAt: conn.last_sync_at,
          lastError: conn.last_error,
          consecutiveFailures: conn.consecutive_failures,
        })
      : null;

    const layers: CalendarLayer[] = [];

    for (const c of (calendars.data ?? []) as Array<{
      id: string;
      summary: string;
      background_color: string | null;
      is_visible: boolean;
      blocks_availability: boolean;
      is_primary: boolean;
      access_role: string | null;
    }>) {
      layers.push({
        id: c.id,
        source: "google",
        name: c.summary,
        color: c.background_color,
        isVisible: c.is_visible,
        blocksAvailability: c.blocks_availability,
        isPrimary: c.is_primary,
        canWrite: c.access_role === "owner" || c.access_role === "writer",
        health: googleHealth ?? { state: "ok", message: null },
      });
    }

    for (const f of (feeds.data ?? []) as Array<{
      id: string;
      label: string;
      is_active: boolean;
      last_success_at: string | null;
      last_error: string | null;
      consecutive_failures: number;
    }>) {
      layers.push({
        id: f.id,
        source: "ics",
        name: f.label,
        // ICS carries no color of its own, so the client assigns one.
        color: null,
        isVisible: f.is_active,
        blocksAvailability: f.is_active,
        isPrimary: false,
        // A subscribed feed is a one-way read; there is nowhere to push to.
        canWrite: false,
        health: feedHealth({
          lastSuccessAt: f.last_success_at,
          lastError: f.last_error,
          consecutiveFailures: f.consecutive_failures,
        }),
      });
    }

    // Events come only from calendars the member is showing. Filtering here
    // rather than in the client keeps a hidden calendar's contents off the wire
    // entirely — the checkbox hides the data, not just the pixels.
    const visibleGoogle = layers.filter((l) => l.source === "google" && l.isVisible).map((l) => l.id);

    let events: Array<Record<string, unknown>> = [];
    if (visibleGoogle.length) {
      const { data } = await supabase
        .from("external_events")
        .select("id, calendar_id, summary, location, html_link, starts_at, ends_at, is_all_day, status, transparency")
        .eq("user_id", userId)
        .in("calendar_id", visibleGoogle)
        .lt("starts_at", window.to)
        .gt("ends_at", window.from)
        .order("starts_at", { ascending: true })
        .limit(MAX_EVENTS);

      events = ((data ?? []) as Array<Record<string, unknown>>).filter((e) => e.status !== "cancelled");
    }

    return NextResponse.json({
      connectedAs: conn?.google_email ?? null,
      // The client cannot know this: without OAuth credentials deployed there
      // is nothing to connect to, and offering the button would dead-end.
      googleConfigured: googleOAuthConfigured(),
      layers,
      events: events.map((e) => ({
        id: e.id,
        calendarId: e.calendar_id,
        title: e.summary ?? "(no title)",
        location: e.location ?? null,
        link: e.html_link ?? null,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        isAllDay: e.is_all_day,
        // The grid dims an event that does not actually occupy its owner.
        isBusy: e.transparency !== "transparent",
      })),
    });
  } catch (err) {
    console.error("[/api/meetings/calendars] GET", err);
    return NextResponse.json({ error: "Failed to load calendars" }, { status: 500 });
  }
}

function parseWindow(
  params: URLSearchParams,
): { ok: true; from: string; to: string } | { ok: false; error: string } {
  const fromRaw = params.get("from");
  const toRaw = params.get("to");
  if (!fromRaw || !toRaw) return { ok: false, error: "from and to are required." };

  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return { ok: false, error: "from and to must be dates." };
  if (to <= from) return { ok: false, error: "to must be after from." };

  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days > MAX_WINDOW_DAYS) return { ok: false, error: "That range is too wide." };

  return { ok: true, from: from.toISOString(), to: to.toISOString() };
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      source?: "google" | "ics";
      isVisible?: boolean;
      blocksAvailability?: boolean;
    };
    if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 422 });

    const supabase = await createServerClient();
    const now = new Date().toISOString();

    if (body.source === "ics") {
      // A feed has one switch: subscribed or not. Hiding it and excluding it
      // from availability are the same act.
      if (typeof body.isVisible !== "boolean") {
        return NextResponse.json({ error: "isVisible is required for a feed." }, { status: 422 });
      }
      const { error } = await supabase
        .from("calendar_feeds")
        .update({ is_active: body.isVisible, updated_at: now } as never)
        .eq("id", body.id)
        .eq("user_id", auth.ctx.userId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    const patch: Record<string, unknown> = { updated_at: now };
    if (typeof body.isVisible === "boolean") patch.is_visible = body.isVisible;
    if (typeof body.blocksAvailability === "boolean") patch.blocks_availability = body.blocksAvailability;
    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 422 });
    }

    // The user_id filter is belt-and-braces over RLS: this route must not be
    // able to flip a toggle on someone else's calendar even if a policy is
    // later loosened.
    const { error } = await supabase
      .from("google_calendars")
      .update(patch as never)
      .eq("id", body.id)
      .eq("user_id", auth.ctx.userId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/meetings/calendars] PATCH", err);
    return NextResponse.json({ error: "Failed to update that calendar" }, { status: 500 });
  }
}
