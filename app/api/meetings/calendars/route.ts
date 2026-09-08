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
/** Ceiling on events returned per source. A month view draws far fewer. */
const MAX_EVENTS = 2000;

/** One event as the grid consumes it, whichever calendar it came from. */
interface ClientEvent {
  id: string;
  calendarId: string;
  title: string;
  location: string | null;
  link: string | null;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  isBusy: boolean;
}

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
    const visibleFeeds = layers.filter((l) => l.source === "ics" && l.isVisible).map((l) => l.id);

    // The two sources are stored apart — one is Google's shape, one iCalendar's
    // — but the grid has no reason to care which a conflict came from, so they
    // are normalized to one list here. Each keeps its own layer's id as
    // `calendarId`, which is how the client colours it and how the layer
    // checkbox hides it.
    const [googleEvents, feedEvents] = await Promise.all([
      visibleGoogle.length
        ? supabase
            .from("external_events")
            .select("id, calendar_id, summary, location, html_link, starts_at, ends_at, is_all_day, status, transparency")
            .eq("user_id", userId)
            .in("calendar_id", visibleGoogle)
            .lt("starts_at", window.to)
            .gt("ends_at", window.from)
            .order("starts_at", { ascending: true })
            .limit(MAX_EVENTS)
        : Promise.resolve({ data: [] }),
      visibleFeeds.length
        ? supabase
            .from("calendar_feed_events")
            .select("id, feed_id, summary, location, starts_at, ends_at, is_all_day, status, transparent")
            .eq("user_id", userId)
            .in("feed_id", visibleFeeds)
            .lt("starts_at", window.to)
            .gt("ends_at", window.from)
            .order("starts_at", { ascending: true })
            .limit(MAX_EVENTS)
        : Promise.resolve({ data: [] }),
    ]);

    // Neither source may take the other down, and neither may fail in silence.
    //
    // A query error here resolves rather than throws, so without this the rail
    // would render an empty calendar and say nothing — which is the exact
    // failure this whole change exists to remove, reintroduced one level up.
    // The concrete case: migrations apply on push to main in parallel with the
    // deploy, so for a few seconds the code is live and calendar_feed_events is
    // not there yet. Feeds should be missing from that calendar. The member's
    // Google events and their layer list should not.
    const unavailable: Array<"google" | "ics"> = [];
    for (const [source, result] of [
      ["google", googleEvents],
      ["ics", feedEvents],
    ] as const) {
      const error = (result as { error?: { message?: string } }).error;
      if (!error) continue;
      console.error(`[/api/meetings/calendars] ${source} events unavailable`, error.message);
      unavailable.push(source);
    }

    const events: ClientEvent[] = [];

    for (const e of (googleEvents.data ?? []) as Array<Record<string, unknown>>) {
      if (e.status === "cancelled") continue;
      events.push({
        id: String(e.id),
        calendarId: String(e.calendar_id),
        title: (e.summary as string) ?? "(no title)",
        location: (e.location as string) ?? null,
        link: (e.html_link as string) ?? null,
        startsAt: String(e.starts_at),
        endsAt: String(e.ends_at),
        isAllDay: Boolean(e.is_all_day),
        // The grid dims an event that does not actually occupy its owner.
        isBusy: e.transparency !== "transparent",
      });
    }

    for (const e of (feedEvents.data ?? []) as Array<Record<string, unknown>>) {
      // A feed can carry its own tombstones; a cancelled event is not on the
      // calendar any more than a cancelled Google one is.
      if (typeof e.status === "string" && e.status.toUpperCase() === "CANCELLED") continue;
      events.push({
        id: String(e.id),
        calendarId: String(e.feed_id),
        title: (e.summary as string) ?? "(no title)",
        location: (e.location as string) ?? null,
        // A subscribed feed is a read-only copy; there is nowhere to send
        // someone to open the original.
        link: null,
        startsAt: String(e.starts_at),
        endsAt: String(e.ends_at),
        isAllDay: Boolean(e.is_all_day),
        // RFC 5545 TRANSP, the iCalendar spelling of Google's transparency.
        isBusy: !e.transparent,
      });
    }

    // One ordering across both sources, so the grid lays out lanes the same way
    // whichever calendar an event came from.
    events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    return NextResponse.json({
      connectedAs: conn?.google_email ?? null,
      // The client cannot know this: without OAuth credentials deployed there
      // is nothing to connect to, and offering the button would dead-end.
      googleConfigured: googleOAuthConfigured(),
      layers,
      events,
      // Which sources could not be read, so the rail can say so.
      //
      // Deliberately not a 500. Failing the whole request would take down the
      // layer list and the source that DID work, leaving a member who lost
      // their feed events with no calendars at all — a worse answer, and one
      // that still tells them nothing. What actually matters is that an empty
      // grid never reads as an empty schedule, and that is a thing to say, not
      // a status code.
      unavailable,
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
