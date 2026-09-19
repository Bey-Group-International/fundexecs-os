// app/api/meetings/delete/route.ts
// Deleting a meeting, and everything a meeting leaves behind.
//
// The rows have always taken care of themselves: live_meeting_recordings,
// _chunks, _transcripts, _reports and the rest all cascade from live_meetings.
// The BYTES did not. A recording is parts in a private Storage bucket, keyed
// `<meeting_id>/<recording_id>/part-NNNNNN.webm`, and nothing in the cascade
// reaches them — so a hard delete removed every row that knew a recording
// existed and left the recording itself in place.
//
// That is not merely a bill. It did not leave the media accessible-and-
// therefore-arguably-fine either: the bucket's read policy asks
// `attended_live_meeting(meeting_id)`, which resolves through live_meetings, so
// with the meeting gone nobody could read them. A host pressed Delete, was told
// it was done, and the faces, voices and shared screens stayed — unreachable,
// unfindable by the expiry sweep, and kept indefinitely.
//
// So a hard delete now removes the objects first. The sweep still catches what
// this cannot — meetings deleted before this existed, and the scheduling
// service, which deletes meetings without coming through here — but a host who
// asks for their recording to be gone should not wait an hour to be told the
// truth.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { removeMeetingRecordings } from "@/lib/meetings/recording-sweep.server";

/**
 * Meeting ids read per page when enumerating what a "clear all" will delete.
 *
 * Paged to exhaustion rather than capped, because the delete itself is not
 * capped: reading one page and deleting everything strands the recordings of
 * every meeting past it. The page size is a bound on a query, not on how many
 * meetings are read.
 */
const CLEANUP_PAGE = 500;

/**
 * Pages one enumeration may take before it gives up and leaves the remainder
 * to the sweep. Twenty thousand meetings for a single host is not a host.
 */
const MAX_CLEANUP_PAGES = 40;

export async function DELETE(req: NextRequest) {
  // Scope every delete to the caller's ACTIVE org. Scoping by host_id alone let a
  // user who hosts meetings in multiple orgs wipe meetings across all of them with
  // clearAll — this bounds it to the org whose meetings they're actually viewing.
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const supabase = await createServerClient();

  const body = (await req.json().catch(() => ({}))) as {
    meetingId?: string;
    clearAll?: boolean;
    soft?: boolean;
  };

  // deleted_at added in migration 20260702000003; types not yet regenerated
  const softPayload = { deleted_at: new Date().toISOString() } as any;

  if (body.clearAll) {
    if (body.soft) {
      const { error } = await supabase
        .from("live_meetings")
        .update(softPayload)
        .eq("organization_id", auth.ctx.orgId)
        .eq("host_id", auth.ctx.userId)
        .is("deleted_at", null);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      // Read the ids before the delete, because after it there is nothing left
      // to say which meetings these were. This is the whole reason the objects
      // had to be orphaned rather than deleted: the cascade destroys the
      // evidence of what to clean up.
      let doomed: string[];
      try {
        doomed = await hostMeetingIds(supabase, auth.ctx.orgId, auth.ctx.userId);
      } catch (err) {
        // Fails closed. Deleting first and discovering afterwards that the list
        // could not be read is the exact shape this route exists to stop: rows
        // gone, objects stranded, and a 200 saying it was done. Nothing has
        // been destroyed yet, so the honest answer is to refuse and be retried.
        console.error("[meetings/delete] could not enumerate meetings to clear", err);
        return NextResponse.json(
          { error: "Could not read the meetings to delete" },
          { status: 500 },
        );
      }

      const { error } = await supabase
        .from("live_meetings")
        .delete()
        .eq("organization_id", auth.ctx.orgId)
        .eq("host_id", auth.ctx.userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await dropRecordings(doomed);
    }
    return NextResponse.json({ ok: true });
  }

  if (!body.meetingId) {
    return NextResponse.json({ error: "meetingId required" }, { status: 400 });
  }

  if (body.soft) {
    const { error } = await supabase
      .from("live_meetings")
      .update(softPayload)
      .eq("id", body.meetingId)
      .eq("organization_id", auth.ctx.orgId)
      .eq("host_id", auth.ctx.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // Ownership is proved by the delete itself — it is scoped to this host in
    // this org — so the objects are only removed once a row actually went.
    // Otherwise a caller naming somebody else's meeting id would delete their
    // recording while the row correctly refused to budge.
    const { data: removed, error } = await supabase
      .from("live_meetings")
      .delete()
      .eq("id", body.meetingId)
      .eq("organization_id", auth.ctx.orgId)
      .eq("host_id", auth.ctx.userId)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await dropRecordings(((removed ?? []) as { id: string }[]).map((m) => m.id));
  }

  return NextResponse.json({ ok: true });
}

/**
 * Delete the stored recordings of meetings that have just been removed.
 *
 * Never throws into the response. The rows are already gone by the time this
 * runs, so failing the request would tell the host their meeting is still there
 * when it is not — and the hourly sweep's orphan pass finds exactly what this
 * missed, because a meeting folder with no meeting is the thing it looks for.
 *
 * Service role where it is configured: the caller's own client is bound by the
 * bucket's read and insert policies, both of which resolve through
 * `live_meetings` — a table this function is called after deleting from.
 */
/**
 * Every meeting this host owns in this org, paged.
 *
 * Ordered by id so the pages are stable — an unordered paged read can return
 * the same row twice and miss another, and a missed row here is a recording
 * nothing deletes. Throws on a read error: the caller must not delete rows it
 * could not enumerate.
 *
 * Exceeding the page cap is NOT an error. That leaves a remainder rather than
 * a blank, and the sweep's orphan pass scans the whole bucket, so what is left
 * is found within the hour.
 */
async function hostMeetingIds(
  supabase: { from: (table: string) => any },
  orgId: string,
  userId: string,
): Promise<string[]> {
  const ids: string[] = [];

  for (let page = 0; page < MAX_CLEANUP_PAGES; page++) {
    const from = page * CLEANUP_PAGE;
    const { data, error } = await supabase
      .from("live_meetings")
      .select("id")
      .eq("organization_id", orgId)
      .eq("host_id", userId)
      .order("id", { ascending: true })
      .range(from, from + CLEANUP_PAGE - 1);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as { id: string }[];
    for (const row of rows) ids.push(row.id);
    if (rows.length < CLEANUP_PAGE) return ids;
  }

  console.warn(
    `[meetings/delete] stopped enumerating after ${MAX_CLEANUP_PAGES} pages; the sweep takes the rest`,
  );
  return ids;
}

async function dropRecordings(meetingIds: readonly string[]): Promise<void> {
  if (meetingIds.length === 0 || !hasSupabaseServiceEnv()) return;
  const service = createServiceClient();
  await Promise.all(
    meetingIds.map(async (id) => {
      try {
        await removeMeetingRecordings(service as never, id);
      } catch (err) {
        console.warn("[meetings/delete] recording objects left for the sweep", id, err);
      }
    }),
  );
}
