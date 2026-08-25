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

    const { data: meetings } = await supabase
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
