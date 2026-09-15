import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { syncMeetingExternal } from "@/lib/meetings/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

/**
 * Take a meeting off the host's connected calendar, or put it back.
 *
 * The machinery for this already existed and nothing could reach it.
 * `decideWrite` has always returned a `delete` when a meeting's
 * `external_calendar_sync_enabled` is false, and `syncMeetingExternal` has
 * always been willing to carry that out — but no code path anywhere ever set
 * that column to false. A meeting pushed to Google stayed on the calendar for
 * good unless the whole meeting was deleted.
 *
 * So this is two lines of real work: flip the flag, then run the sync that
 * already knows what to do with it.
 *
 * DELETE removes it from the calendar and KEEPS the meeting. That distinction
 * is the point: a meeting that has moved to a different system, or was put on
 * the calendar by mistake, is still a meeting that happened. Deleting the
 * meeting is a different action with a different button.
 */
export async function DELETE(_req: Request, { params }: { params: Params }) {
  return setCalendarSync(params, false);
}

/** PUT restores it: same flag, same sync, other direction. */
export async function PUT(_req: Request, { params }: { params: Params }) {
  return setCalendarSync(params, true);
}

async function setCalendarSync(params: Params, enabled: boolean) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const supabase = await createServerClient();

  // Scoped to the org and to the host. Calendar events land in somebody's
  // personal calendar under their own Google grant, so "who may take it off
  // again" is the person whose calendar it is on.
  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, host_id, external_calendar_event_id, external_calendar_sync_enabled")
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  const row = meeting as {
    id: string;
    host_id: string | null;
    external_calendar_event_id: string | null;
    external_calendar_sync_enabled: boolean | null;
  } | null;

  if (!row) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (row.host_id !== auth.ctx.userId) {
    return NextResponse.json(
      { error: "Only the meeting's host can change its calendar sync." },
      { status: 403 },
    );
  }

  // Already in the requested state and nothing on the calendar to clean up.
  // Answered as success rather than as a no-op error: the caller asked for an
  // end state and the end state holds.
  if (row.external_calendar_sync_enabled === enabled && !(enabled === false && row.external_calendar_event_id)) {
    return NextResponse.json({ ok: true, syncEnabled: enabled, unchanged: true });
  }

  const { error: updateError } = await supabase
    .from("live_meetings")
    .update({ external_calendar_sync_enabled: enabled })
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  try {
    // Reads the flag we just wrote and decides for itself: with sync off and an
    // event id on file, that decision is `delete`.
    const result = await syncMeetingExternal(
      supabase,
      { orgId: auth.ctx.orgId, userId: auth.ctx.userId },
      id,
    );
    return NextResponse.json({ ok: result.ok, syncEnabled: enabled, status: result.status, error: result.error });
  } catch (error) {
    // The flag is already written, so the next sweep or manual sync will finish
    // the job. Reported as a partial success rather than a failure, because
    // "this will come off shortly" is true and "nothing happened" is not.
    return NextResponse.json(
      {
        ok: false,
        syncEnabled: enabled,
        error: error instanceof Error ? error.message : "Calendar could not be reached",
      },
      { status: 202 },
    );
  }
}
