import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { CONVERSATIONAL_COST, gateConversationalSpend } from "@/lib/conversational-gate";
import { toLogEntry } from "@/lib/meetings/meeting-log";
import { cleanCorrection } from "@/lib/meetings/report-versions";
import { generateReportFromStoredTranscript } from "@/lib/meetings/report-generation.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The model call runs on the long-run client: LONG_RUN_TIMEOUT_MS with one
// retry, so up to 240s of upstream time. The platform's default function
// envelope is shorter than that, and a run cut off by the platform surfaces
// as an opaque 504 with the report half-written nowhere. The report page's
// REPORT_WAIT_LIMIT_MS is derived from this same 300s assumption.
export const maxDuration = 300;

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
 * already on file and from the rows the call wrote. That is the whole point:
 * the feature this replaces asked a member to paste a transcript by hand to
 * get an analysis of a meeting the app had already recorded and already
 * analysed.
 *
 * **Also the FIRST report, for a meeting nobody ended.** A host who shut the
 * laptop instead of pressing End left a meeting `active` with its transcript
 * in the table and no report row at all — and the only route that could write
 * one was the room's, which needs the room. This route now does it: when there
 * is no report row the stored rows alone are enough, and the meeting is marked
 * ended as part of the write, exactly as the room's route would have done.
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
 *
 * **Takes a correction.** `{ correction: "The follow-up is to Jane, not me" }`
 * is handed to the model as overriding the transcript, alongside the version it
 * corrects, and is kept on the new row so the history can say why it exists.
 * Without one this is the plain re-read it always was.
 *
 * The sequence itself lives in lib/meetings/report-generation.server.ts,
 * because the hourly sweep runs the same one without a session.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const payload = (await req.json().catch(() => ({}))) as { correction?: unknown };
  const correction = cleanCorrection(payload?.correction);

  const supabase = await createServerClient();

  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, room_code, title, host_id, organization_id, deal_id, attendees, created_at, started_at, ended_at, scheduled_at, duration_minutes, status, is_draft")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (meeting.host_id !== auth.ctx.userId) {
    return NextResponse.json({ error: "Only the meeting host can regenerate the report" }, { status: 403 });
  }

  let outcome;
  try {
    outcome = await generateReportFromStoredTranscript(supabase, {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        host_id: meeting.host_id,
        organization_id: meeting.organization_id,
        deal_id: (meeting as { deal_id?: string | null }).deal_id ?? null,
        attendees: meeting.attendees,
        status: meeting.status,
        started_at: meeting.started_at,
        ended_at: meeting.ended_at,
      },
      hostEmail: auth.ctx.email || null,
      client,
      model: MODEL,
      correction: correction || null,
      // Charged only once there is something worth asking the model about: a
      // silent or noise-only transcript is filed without a call and without a
      // credit.
      beforeModel: async () => {
        const gate = await gateConversationalSpend(auth.ctx.orgId, CONVERSATIONAL_COST.meetingAnalyze, "meeting_analyze");
        return gate.ok
          ? { ok: true }
          : { ok: false, status: gate.status ?? 402, error: gate.error ?? "Not enough credits" };
      },
    });
  } catch (err) {
    console.error("[/api/meetings/:id/report/regenerate]", err);
    return NextResponse.json({ error: "Could not analyse the transcript. Try again." }, { status: 502 });
  }

  switch (outcome.kind) {
    case "no_transcript":
      // Nothing to re-read. Said plainly, because "regenerate" on a meeting
      // that was never transcribed would otherwise look like a silent failure.
      return NextResponse.json(
        { error: "This meeting has no transcript on file, so there is nothing to analyse." },
        { status: 409 },
      );
    case "refused":
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    case "unsummarised":
      // Filed as a finished report with nothing in it, when there was no real
      // report to protect; otherwise the readable one stays the newest.
      return NextResponse.json(
        outcome.written
          ? { unsummarised: true, reason: outcome.reason }
          : { error: "No usable speech was captured, so the existing report was left in place.", reason: outcome.reason },
        { status: outcome.written ? 200 : 409 },
      );
    case "empty":
      // An empty report would replace a real one in the log with nothing.
      // Refuse rather than append it: the existing report stays the newest,
      // and the host is told the run produced nothing instead of watching
      // their report vanish.
      return NextResponse.json(
        { error: "The analysis came back empty, so the existing report was left in place." },
        { status: 502 },
      );
    case "save_failed":
      console.error("[/api/meetings/:id/report/regenerate] insert failed", outcome.error);
      return NextResponse.json({ error: "Could not save the new report." }, { status: 500 });
    case "written":
      break;
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
        // As closed by this run, for a meeting that was still open: the log
        // dates an entry by its end, and a row that still said `active` would
        // keep it out of the log the button sits in.
        started_at: outcome.meeting.started_at,
        ended_at: outcome.meeting.ended_at,
        scheduled_at: meeting.scheduled_at,
        duration_minutes: meeting.duration_minutes,
        status: outcome.meeting.status,
        attendees: meeting.attendees,
      },
      {
        ...outcome.saved,
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
