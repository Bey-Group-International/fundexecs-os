// The published iCalendar feed: a member's FundExecs meetings, in the format
// Google, Outlook, and Apple Calendar all subscribe to.
//
// Deliberately unauthenticated. Calendar clients cannot carry a session — they
// fetch a bare URL on their own schedule — so the secret token in the path IS
// the credential. Everything follows from that: the token is long and random,
// the response is noindex and uncacheable by shared caches, and a wrong token
// is a flat 404 that reveals nothing about whether it ever existed.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { buildIcs, type IcsFeedEvent } from "@/lib/calendar/ics";
import { SITE_URL } from "@/lib/site";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How much history to include. Enough context, without an unbounded feed. */
const PAST_DAYS = 30;
const FUTURE_DAYS = 365;
const MAX_EVENTS = 1000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Strip the .ics suffix subscribers often append or expect.
  const clean = (token ?? "").replace(/\.ics$/i, "").trim();

  // A short token is not a near-miss worth reporting — it is a guess.
  if (!clean || clean.length < 20) return notFound();
  if (!hasSupabaseServiceEnv()) return notFound();

  try {
    const supabase = createServiceClient();

    // Service-role: the caller has no session, only the token. The token is
    // the entire authorization check, so it is matched exactly.
    const { data: page } = await supabase
      .from("scheduling_pages")
      .select("user_id, display_name, timezone")
      .eq("ics_feed_token", clean)
      .maybeSingle();
    if (!page) return notFound();

    const owner = page as { user_id: string; display_name: string; timezone: string };
    const now = Date.now();
    const from = new Date(now - PAST_DAYS * 86_400_000).toISOString();
    const to = new Date(now + FUTURE_DAYS * 86_400_000).toISOString();

    // Requests still waiting on the host's decision. They already hold their
    // slot (the booking page offers it to nobody else), so they belong on the
    // host's calendar too; without them, a host could promise the same hour
    // elsewhere while a request for it sat unanswered. Once approved, the
    // request becomes a meeting and shows up as that instead.
    const pendingQuery = supabase
      .from("scheduling_bookings")
      .select("id, starts_at, ends_at, invitee_name, calendar_sequence, scheduling_event_types(title)")
      .eq("host_user_id", owner.user_id)
      .eq("status", "pending")
      .gte("starts_at", new Date(now).toISOString())
      .lt("starts_at", to)
      .order("starts_at", { ascending: true })
      .limit(MAX_EVENTS);

    const meetingsQuery = supabase
      .from("live_meetings")
      .select("id, room_code, title, description, location, scheduled_at, duration_minutes, updated_at, status")
      .eq("host_id", owner.user_id)
      .is("deleted_at", null)
      .eq("is_draft", false)
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", from)
      .lt("scheduled_at", to)
      .order("scheduled_at", { ascending: true })
      .limit(MAX_EVENTS);

    // Both keyed on the owner alone, so asked together.
    const [{ data: meetings }, { data: pending, error: pendingError }] = await Promise.all([
      meetingsQuery,
      pendingQuery,
    ]);

    const events: IcsFeedEvent[] = [];
    for (const row of (meetings ?? []) as Array<{
      id: string;
      room_code: string | null;
      title: string | null;
      description: string | null;
      location: string | null;
      scheduled_at: string | null;
      duration_minutes: number | null;
      updated_at: string | null;
      status: string | null;
    }>) {
      if (!row.scheduled_at) continue;
      const start = new Date(row.scheduled_at);
      if (isNaN(start.getTime())) continue;
      const end = new Date(start.getTime() + (row.duration_minutes ?? 60) * 60_000);

      events.push({
        // Stable and globally unique, so a subscriber updates the event it
        // already has instead of creating a duplicate on every refresh.
        uid: `meeting-${row.id}@fundexecs`,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        summary: row.title ?? "Meeting",
        description: row.description,
        location: row.location,
        url: row.room_code ? buildMeetingInviteUrl(SITE_URL, row.room_code) : null,
        // A subscriber only revises an event when SEQUENCE increases, so this
        // derives from updated_at: without it, an edited meeting would keep
        // showing at its old time in every subscribed calendar.
        sequence: sequenceFor(row.updated_at),
      });
    }

    // A failure here costs the requests, not the feed: the meetings still go out.
    if (pendingError) console.error("[/api/calendar/feed] pending bookings", pendingError.message);
    for (const row of (pending ?? []) as unknown as Array<{
      id: string;
      starts_at: string;
      ends_at: string;
      invitee_name: string | null;
      calendar_sequence: number | null;
      scheduling_event_types: { title: string | null } | { title: string | null }[] | null;
    }>) {
      const type = Array.isArray(row.scheduling_event_types) ? row.scheduling_event_types[0] : row.scheduling_event_types;
      const what = type?.title?.trim() || "Meeting";
      const who = row.invitee_name?.trim();
      events.push({
        uid: `booking-${row.id}@fundexecs`,
        startIso: row.starts_at,
        endIso: row.ends_at,
        summary: `Requested: ${what}${who ? ` with ${who}` : ""}`,
        description: "Waiting for you to confirm or decline in FundExecs.",
        url: `${SITE_URL}/meetings`,
        tentative: true,
        sequence: row.calendar_sequence ?? 0,
      });
    }

    const body = buildIcs(events, {
      calendarName: `${owner.display_name} — FundExecs`,
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        // Subscribers that download rather than subscribe get a sane filename.
        "Content-Disposition": 'inline; filename="fundexecs.ics"',
        // The URL is a secret, so no shared cache may hold the response.
        "Cache-Control": "private, no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    console.error("[/api/calendar/feed] GET", err);
    // Even an internal failure answers 404: a 500 here would confirm to a
    // guesser that some tokens behave differently from others.
    return notFound();
  }
}

/** A monotonic revision number from a timestamp, in whole minutes. */
function sequenceFor(updatedAt: string | null): number {
  if (!updatedAt) return 0;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.floor(t / 60_000);
}

function notFound(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}
