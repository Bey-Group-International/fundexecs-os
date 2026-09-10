import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { CONVERSATIONAL_COST, gateConversationalSpend } from "@/lib/conversational-gate";
import { generateMeetingReport } from "@/lib/meetings/report-analysis";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { toLogEntry } from "@/lib/meetings/meeting-log";
import type { Json } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

const client = process.env.ANTHROPIC_API_KEY
  ? anthropicClient(process.env.ANTHROPIC_API_KEY, LONG_RUN_TIMEOUT_MS)
  : null;

/**
 * `POST /api/meetings/:id/report/regenerate`
 *
 * Re-read a meeting's own transcript and write a fresh report from it.
 *
 * The transcript is never sent by the caller — it is read from the report
 * already on file. That is the whole point: the feature this replaces asked a
 * member to paste a transcript by hand to get an analysis of a meeting the app
 * had already recorded and already analysed.
 *
 * **Appends rather than overwrites.** A new `live_meeting_reports` row is
 * inserted, exactly as the end-of-meeting route does, so the previous report
 * survives. The log embeds reports ordered `created_at desc` limit 1, so it
 * shows the new one immediately while the old one stays readable in the table.
 * Nothing a colleague may have relied on is destroyed, which is why this needs
 * no "are you sure" — there is nothing to lose.
 *
 * Host only, mirroring `/api/meetings/report`: the report is a shared record,
 * and rewriting what a meeting decided belongs to the person who ran it.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = await createServerClient();

  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, room_code, title, host_id, organization_id, attendees, created_at, started_at, ended_at, scheduled_at, duration_minutes, status, is_draft")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (meeting.host_id !== auth.ctx.userId) {
    return NextResponse.json({ error: "Only the meeting host can regenerate the report" }, { status: 403 });
  }

  // Newest report first — the transcript to work from is the one the latest
  // report was built on, not whichever row the database happens to return.
  const { data: existing } = await supabase
    .from("live_meeting_reports")
    .select("id, full_transcript")
    .eq("meeting_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const transcript = (existing?.full_transcript ?? "").trim();
  if (!transcript) {
    // Nothing to re-read. Said plainly, because "regenerate" on a meeting that
    // was never transcribed would otherwise look like a silent failure.
    return NextResponse.json(
      { error: "This meeting has no transcript on file, so there is nothing to analyse." },
      { status: 409 },
    );
  }

  const gate = await gateConversationalSpend(
    auth.ctx.orgId,
    CONVERSATIONAL_COST.meetingAnalyze,
    "meeting_analyze",
  );
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
  const participants = attendees
    .map((a) => {
      if (!a || typeof a !== "object" || Array.isArray(a)) return "";
      const rec = a as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      const email = typeof rec.email === "string" ? rec.email.trim() : "";
      return name || email;
    })
    .filter(Boolean);

  let analysis: Record<string, unknown>;
  try {
    analysis = await generateMeetingReport(client, MODEL, {
      title: meeting.title ?? "Untitled",
      participants,
      transcript,
      durationSeconds: meeting.duration_minutes ? meeting.duration_minutes * 60 : null,
    });
  } catch (err) {
    console.error("[/api/meetings/:id/report/regenerate]", err);
    return NextResponse.json({ error: "Could not analyse the transcript. Try again." }, { status: 502 });
  }

  if (!normalizeNoteText(analysis.summary)) {
    // An empty report would replace a real one in the log with nothing. Refuse
    // rather than append it: the existing report stays the newest, and the host
    // is told the run produced nothing instead of watching their report vanish.
    return NextResponse.json(
      { error: "The analysis came back empty, so the existing report was left in place." },
      { status: 502 },
    );
  }

  const { data: saved, error } = await supabase
    .from("live_meeting_reports")
    .insert({
      meeting_id: id,
      summary: normalizeNoteText(analysis.summary),
      key_points: normalizeNoteList(analysis.key_points) as Json,
      action_items: normalizeNoteList(analysis.action_items) as Json,
      // Carried forward unchanged: the transcript is the record of what was
      // said, and a regeneration reinterprets it rather than replacing it.
      full_transcript: transcript,
      analysis: analysis as Json,
    })
    .select("summary, key_points, action_items, analysis")
    .single();

  if (error || !saved) {
    console.error("[/api/meetings/:id/report/regenerate] insert failed", error);
    return NextResponse.json({ error: "Could not save the new report." }, { status: 500 });
  }

  // Hand back the same shape the log renders, so the row updates in place
  // rather than the page having to reload to show what just changed.
  return NextResponse.json({
    entry: toLogEntry(
      {
        id: meeting.id,
        room_code: meeting.room_code,
        title: meeting.title,
        created_at: meeting.created_at,
        started_at: meeting.started_at,
        ended_at: meeting.ended_at,
        scheduled_at: meeting.scheduled_at,
        duration_minutes: meeting.duration_minutes,
        status: meeting.status,
        attendees: meeting.attendees,
      },
      {
        summary: saved.summary,
        key_points: saved.key_points,
        action_items: saved.action_items,
        // `analysis` comes back typed as Json (which includes scalars); the log
        // wants the object form it was written as.
        analysis: (saved.analysis ?? null) as Record<string, unknown> | null,
        // The row just written carries the same transcript this route read to
        // write it — the 409 above guarantees it was non-empty. Saying so keeps
        // the regenerate button on the row it replaces; the generated column
        // says the same thing on the next load.
        has_transcript: true,
      },
      true,
      // attended AND isHost. Only the host reaches this line, and the log gates
      // the regenerate button on `isHost` — omitting it defaulted the returned
      // entry to false, so the button disappeared the first time it was used.
      true,
    ),
  });
}
