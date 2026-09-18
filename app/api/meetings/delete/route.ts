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
 * Most meetings one "clear all" will strip recordings from.
 *
 * Only a bound on the work done inside one request; anything past it is taken
 * by the orphan pass of the hourly sweep, which exists for exactly this.
 */
const MAX_RECORDING_CLEANUP = 50;

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
      const { data: doomed } = await supabase
        .from("live_meetings")
        .select("id")
        .eq("organization_id", auth.ctx.orgId)
        .eq("host_id", auth.ctx.userId)
        .limit(MAX_RECORDING_CLEANUP);

      const { error } = await supabase
        .from("live_meetings")
        .delete()
        .eq("organization_id", auth.ctx.orgId)
        .eq("host_id", auth.ctx.userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await dropRecordings(((doomed ?? []) as { id: string }[]).map((m) => m.id));
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
