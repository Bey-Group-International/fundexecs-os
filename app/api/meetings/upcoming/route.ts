import { NextResponse } from "next/server";
import { MEETING_KIND } from "@/lib/meetings/one-way";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { isUpcomingMeeting, upcomingWindowStart } from "@/lib/meetings/schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = await createServerClient();
  // One clock for the fetch window and the filter below. Read twice, a meeting
  // could fall between them and be fetched but not returned.
  const now = Date.now();
  const { data, error } = await supabase
    .from("live_meetings")
    .select("id, room_code, title, description, location, meeting_url, status, scheduled_at, duration_minutes, timezone, meeting_type, priority, tags, attendees, source, sync_status, source_event_id, source_calendar_id, deal_id, related_contact_id, related_fund_id, objective, agenda, preparation_requirements, preparation_status, followup_status, assigned_copilot_agent, related_record_type, related_record_id, calendar_visibility, reminder_minutes, external_calendar_provider, external_calendar_sync_enabled, external_calendar_sync_status, is_draft, locked_at, updated_at, guest_quick_access, series_id, series_index, series_rule")
    .eq("organization_id", auth.ctx.orgId)
    // A one-way call has no scheduled_at, so the range filter below already
    // excludes it. Said out loud anyway: a later change that relaxes the date
    // range would otherwise silently start listing recorded calls as meetings
    // waiting to happen.
    .eq("kind", MEETING_KIND)
    .is("deleted_at", null)
    .eq("is_draft", false)
    .neq("status", "ended")
    // Reaches BACK the longest a meeting can run, not forward from now.
    //
    // This filter was `scheduled_at >= now`, which is a start-time rule standing
    // in for an end-time one — so a meeting already in progress was excluded.
    // The meetings page includes it (its own filter keys off the END), and the
    // list refetches this route on mount: the meeting rendered on first paint
    // and then disappeared about a second later, taking its Join button with it,
    // at the moment somebody was most likely trying to join.
    //
    // SQL cannot compare against scheduled_at + duration without a generated
    // column, so the window is widened to everything that COULD still be
    // running and `isUpcomingMeeting` — the same predicate the page uses —
    // narrows it below.
    .gte("scheduled_at", upcomingWindowStart(now).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { status: string | null; scheduled_at: string | null; duration_minutes: number | null; is_draft: boolean | null };
  const upcoming = ((data ?? []) as unknown as Row[]).filter((row) =>
    isUpcomingMeeting(
      {
        status: (row.status ?? "waiting") as "waiting" | "active" | "ended",
        scheduled_at: row.scheduled_at,
        duration_minutes: row.duration_minutes,
        is_draft: row.is_draft,
      },
      now,
    ),
  );

  return NextResponse.json({ data: upcoming });
}
