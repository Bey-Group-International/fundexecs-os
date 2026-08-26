// A member's calendar connections, both directions:
//   GET  — subscribed external feeds (with health) and this member's own
//          published feed URL.
//   POST — subscribe to an external ICS URL, or mint/rotate the published one.
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { feedHealth, validateFeedUrl } from "@/lib/calendar/feeds";
import { fetchFeed } from "@/lib/calendar/feeds.server";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enough entropy that guessing a feed URL is not a strategy. */
const TOKEN_BYTES = 32;
const MAX_FEEDS_PER_USER = 20;

function publishedUrl(token: string | null): string | null {
  return token ? `${SITE_URL.replace(/\/$/, "")}/api/calendar/feed/${token}.ics` : null;
}

export async function GET() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const supabase = await createServerClient();
    const [feeds, page] = await Promise.all([
      supabase
        .from("calendar_feeds")
        .select("id, label, url, is_active, last_success_at, last_error, consecutive_failures, cached_at")
        .eq("user_id", auth.ctx.userId)
        .order("created_at", { ascending: true })
        .limit(MAX_FEEDS_PER_USER + 5),
      supabase
        .from("scheduling_pages")
        .select("ics_feed_token")
        .eq("user_id", auth.ctx.userId)
        .maybeSingle(),
    ]);

    const rows = (feeds.data ?? []) as Array<{
      id: string;
      label: string;
      url: string;
      is_active: boolean;
      last_success_at: string | null;
      last_error: string | null;
      consecutive_failures: number;
      cached_at: string | null;
    }>;

    return NextResponse.json({
      feeds: rows.map((f) => ({
        id: f.id,
        label: f.label,
        // The URL is a credential to the member's own calendar. They already
        // hold it, but echoing it in full invites it into logs and screen
        // shares, so only enough to recognize which feed this is.
        urlHint: hintFor(f.url),
        isActive: f.is_active,
        lastSuccessAt: f.last_success_at,
        health: feedHealth({
          lastSuccessAt: f.last_success_at,
          lastError: f.last_error,
          consecutiveFailures: f.consecutive_failures,
        }),
      })),
      publishedUrl: publishedUrl((page.data as { ics_feed_token: string | null } | null)?.ics_feed_token ?? null),
    });
  } catch (err) {
    console.error("[/api/meetings/calendar-feeds] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load calendar connections" },
      { status: 500 },
    );
  }
}

/** Host plus a trailing fragment — recognizable, not reusable. */
function hintFor(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.slice(-6);
    return `${u.hostname}/…${tail}`;
  } catch {
    return "calendar feed";
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = (await req.json().catch(() => ({}))) as {
      action?: "subscribe" | "publish" | "unpublish";
      url?: string;
      label?: string;
    };
    const supabase = await createServerClient();

    if (body.action === "publish" || body.action === "unpublish") {
      const token = body.action === "publish" ? randomBytes(TOKEN_BYTES).toString("base64url") : null;
      const { error } = await supabase
        .from("scheduling_pages")
        .update({ ics_feed_token: token, updated_at: new Date().toISOString() } as never)
        .eq("user_id", auth.ctx.userId);
      if (error) throw new Error(error.message);
      // Publishing again rotates the token, which is also how a leaked feed is
      // revoked — every existing subscriber breaks, which is the point.
      return NextResponse.json({ publishedUrl: publishedUrl(token) });
    }

    // Default action: subscribe to an external calendar.
    const valid = validateFeedUrl(body.url ?? "");
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 422 });

    const { count } = await supabase
      .from("calendar_feeds")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.ctx.userId);
    if ((count ?? 0) >= MAX_FEEDS_PER_USER) {
      return NextResponse.json(
        { error: `You can connect up to ${MAX_FEEDS_PER_USER} calendars.` },
        { status: 422 },
      );
    }

    // Verify before saving. A URL that doesn't return a calendar would
    // otherwise sit there importing nothing, which looks exactly like a free
    // calendar and is how double-bookings happen.
    const probe = await fetchFeed(valid.url);
    if (!probe.ok) return NextResponse.json({ error: probe.error }, { status: 422 });

    const label = (body.label ?? "").trim().slice(0, 80) || "External calendar";
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("calendar_feeds")
      .insert({
        user_id: auth.ctx.userId,
        organization_id: auth.ctx.orgId,
        label,
        url: valid.url,
        cached_busy: probe.busy as never,
        cached_at: now,
        last_fetched_at: now,
        last_success_at: now,
      } as never)
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "That calendar is already connected." }, { status: 409 });
      }
      throw new Error(error.message);
    }

    return NextResponse.json(
      { id: (data as { id: string }).id, label, eventCount: probe.eventCount ?? 0 },
      { status: 201 },
    );
  } catch (err) {
    console.error("[/api/meetings/calendar-feeds] POST", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to connect that calendar" },
      { status: 500 },
    );
  }
}
