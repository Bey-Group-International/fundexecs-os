// app/api/meetings/[id]/report/versions/route.ts
// A meeting's report history, and going back to an earlier version.
//
// Every report a meeting has had is already kept — both writers insert, and the
// newest row is the report. This route makes the older rows reachable: GET lists
// them, POST brings one back.
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { logId } from "@/lib/log-safe";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import {
  VERSION_LIMIT,
  reportVersions,
  restoredAnalysis,
  type StoredReportVersion,
} from "@/lib/meetings/report-versions";
import type { Json } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/meetings/:id/report/versions`
 *
 * Newest first; the first is the one everybody reads. Whoever may read the
 * report may read its history — RLS on `live_meeting_reports` decides both, so
 * an attendee sees what the host sees and anybody else sees nothing.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = await createServerClient();

  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, host_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("live_meeting_reports")
    .select("id, created_at, summary, analysis")
    .eq("meeting_id", id)
    .order("created_at", { ascending: false })
    .limit(VERSION_LIMIT);

  if (error) {
    console.error("[/api/meetings/:id/report/versions] read failed", { meetingId: logId(id) }, error.message);
    return NextResponse.json({ error: "The report history could not be read." }, { status: 500 });
  }

  return NextResponse.json({
    versions: reportVersions((data ?? []) as unknown as StoredReportVersion[]),
    canRestore: meeting.host_id === auth.ctx.userId,
  });
}

/**
 * `POST /api/meetings/:id/report/versions` with `{ versionId }`
 *
 * Bring an earlier version back by appending a copy of it, not by deleting what
 * came after. The newest row is the report everywhere — the page, the log, the
 * export, the send — so a copy is the one move that changes all of them at
 * once, and the version being replaced stays in the history to come back to.
 *
 * The transcript is the newest row's, not the old version's. A report
 * interprets the transcript; it does not own it, and a later regenerate may
 * have merged in lines the old version never had.
 *
 * Host only, like regenerating: the report is the record of what the meeting
 * decided, and changing which version that is belongs to whoever ran it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const payload = (await req.json().catch(() => ({}))) as { versionId?: unknown };
  const versionId = typeof payload?.versionId === "string" ? payload.versionId.trim() : "";
  if (!versionId) return NextResponse.json({ error: "versionId required" }, { status: 400 });

  const supabase = await createServerClient();

  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, host_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (meeting.host_id !== auth.ctx.userId) {
    return NextResponse.json({ error: "Only the meeting host can restore a report version." }, { status: 403 });
  }

  const [{ data: target }, { data: newest }] = await Promise.all([
    supabase
      .from("live_meeting_reports")
      .select("id, summary, key_points, action_items, analysis, full_transcript")
      .eq("meeting_id", id)
      .eq("id", versionId)
      .maybeSingle(),
    supabase
      .from("live_meeting_reports")
      .select("id, full_transcript")
      .eq("meeting_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!target) return NextResponse.json({ error: "That version of the report was not found." }, { status: 404 });
  if (newest?.id === target.id) {
    return NextResponse.json({ error: "That version is already the current report." }, { status: 409 });
  }

  const analysis = restoredAnalysis(target.analysis, target.id);
  const { error } = await supabase.from("live_meeting_reports").insert({
    meeting_id: id,
    summary: normalizeNoteText(target.summary),
    key_points: normalizeNoteList(target.key_points) as Json,
    action_items: normalizeNoteList(target.action_items) as Json,
    full_transcript: newest?.full_transcript ?? target.full_transcript ?? null,
    analysis: analysis as Json,
  });

  if (error) {
    console.error("[/api/meetings/:id/report/versions] restore failed", { meetingId: logId(id) }, error.message);
    return NextResponse.json({ error: "The version could not be restored." }, { status: 500 });
  }

  // The list's "Follow-Up Needed" badge follows the report, as it does when a
  // report is regenerated.
  const { error: statusError } = await supabase
    .from("live_meetings")
    .update({
      followup_status: normalizeNoteText(analysis.follow_up_draft) ? "draft" : "not_started",
    } as never)
    .eq("id", id);
  if (statusError) {
    console.error(
      "[/api/meetings/:id/report/versions] follow-up status not updated",
      { meetingId: logId(id) },
      statusError.message,
    );
  }

  return NextResponse.json({ ok: true, restoredFrom: target.id });
}
