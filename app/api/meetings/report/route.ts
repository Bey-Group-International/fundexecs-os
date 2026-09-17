import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { persistInstitutionalMeetingRecord } from "@/lib/meetings/service";
import { createActionItemTasks } from "@/lib/meetings/action-items.server";
import { parseActionItem } from "@/lib/meetings/action-items";
import { loadOrgDirectory } from "@/lib/meetings/directory.server";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import { EMPTY_REPORT, clampTranscript, generateMeetingReport } from "@/lib/meetings/report-analysis";
import { mergeTranscripts, restoreTranscript, type StoredLine } from "@/lib/meetings/transcript-restore";
import { readAllTranscriptRows } from "@/lib/meetings/transcript-read";

export const runtime = "nodejs";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

const client = process.env.ANTHROPIC_API_KEY
  ? anthropicClient(process.env.ANTHROPIC_API_KEY, LONG_RUN_TIMEOUT_MS)
  : null;

type ReportSupabase = Awaited<ReturnType<typeof createServerClient>>;

/**
 * Close a meeting out when the model could not summarise it.
 *
 * Two things here belong to the meeting, not to the model, so a failed
 * analysis must not skip them:
 *
 *  - the transcript is kept on a report row, which is where the regenerate
 *    route reads `full_transcript` from; and
 *  - the meeting is marked ended. This route is the ONLY place that ever
 *    marks one ended, and `/api/meetings/upcoming` lists anything that is
 *    not — so skipping it strands a finished meeting in "Upcoming" forever.
 *
 * Deliberately not doing the rest of the success path: no institutional
 * record and no auto-created tasks. There is nothing to record and no action
 * items to create, and the retry re-runs both.
 */
async function endWithoutAnalysis(
  supabase: ReportSupabase,
  meetingId: string,
  transcript: string,
): Promise<void> {
  await supabase.from("live_meeting_reports").insert({
    meeting_id: meetingId,
    summary: "",
    key_points: [] as import("@/lib/supabase/database.types").Json,
    action_items: [] as import("@/lib/supabase/database.types").Json,
    full_transcript: transcript,
    analysis: { ...EMPTY_REPORT } as import("@/lib/supabase/database.types").Json,
  });
  await supabase
    .from("live_meetings")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", meetingId);
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      meetingId: string;
      title?: string;
      participants?: string[];
      transcript: string;
      duration?: number;
    };

    if (!body.meetingId || !body.transcript?.trim()) {
      return NextResponse.json({ error: "meetingId and transcript required" }, { status: 400 });
    }

    // Verify caller is the meeting host
    const { data: meeting } = await supabase
      .from("live_meetings")
      .select("id, host_id, organization_id, deal_id, title, started_at, scheduled_at")
      .eq("id", body.meetingId)
      .single();

    if (!meeting || meeting.host_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // The transcript on file, not just the one the browser posted.
    //
    // `live_meeting_transcripts` has been written throughout every call this
    // product has ever hosted and read by nothing, anywhere — a backup that was
    // never once restored. The report was built from the host's browser memory
    // alone, so the entire record of a meeting hung on one tab surviving to the
    // end of it: a crash, a reload, a phone call, a closed laptop, and the
    // meeting was gone while the rows that could have rebuilt it sat here.
    //
    // A failure to read is not a failure to report. The posted transcript is
    // still in hand, and answering 500 because the backup was unreachable would
    // lose a meeting we can perfectly well summarise.
    //
    // Paged, because this read is capped. `max_rows = 1000` in
    // supabase/config.toml means an unbounded select returns the first
    // thousand rows in silence, and ordering by `ts` makes those the earliest
    // thousand — so a long meeting was summarised from its opening and not its
    // end. `id` is the tiebreak: rows sharing a timestamp need a total order,
    // or a page boundary landing inside a tie drops a row or repeats one.
    let stored = "";
    try {
      const rows = await readAllTranscriptRows((from, to) =>
        supabase
          .from("live_meeting_transcripts")
          .select("speaker, text, ts, confidence, overlapped")
          .eq("meeting_id", body.meetingId)
          .order("ts", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
      if (rows.length) stored = restoreTranscript(rows as unknown as StoredLine[]);
    } catch (err) {
      console.warn("[/api/meetings/report] stored transcript unavailable", err);
    }

    // Cap transcript to stay within model context / cost budget.
    const transcript = clampTranscript(mergeTranscripts(body.transcript, stored));

    // The prompt and schema live in lib/meetings/report-analysis so the
    // regenerate path produces the identical shape — the log reads
    // `analysis.decisions`, which exists in no column of its own.
    // A model failure is preserved, then reported — it used to be preserved
    // and then reported as success, which is the bug this shape exists to fix.
    // MeetingRoom navigates to the report page on `res.ok` and only offers its
    // "try again" on a failure, so answering 200 with an empty report sent the
    // host to a blank page with no way back: the log's regenerate action is
    // gated on `hasReport` (`summary.length > 0`), so it was hidden for that
    // row too. Answering 500 puts the room in its retry state, and the retry
    // re-posts the transcript it still holds in memory.
    //
    // A missing API key is NOT a failure and still takes the success path:
    // generateMeetingReport returns the empty report rather than throwing.
    let analysis: Record<string, unknown>;
    try {
      analysis = await generateMeetingReport(client, MODEL, {
        title: body.title ?? "Untitled",
        participants: body.participants ?? [],
        transcript,
        durationSeconds: body.duration ?? null,
      });
    } catch (err) {
      console.error("[/api/meetings/report] analysis failed", err);
      await endWithoutAnalysis(supabase, body.meetingId, transcript);
      throw err;
    }

    // Save to DB
    const { data: report, error } = await supabase
      .from("live_meeting_reports")
      .insert({
        meeting_id: body.meetingId,
        summary: normalizeNoteText(analysis.summary),
        key_points: analysis.key_points as import("@/lib/supabase/database.types").Json,
        action_items: analysis.action_items as import("@/lib/supabase/database.types").Json,
        full_transcript: transcript,
        analysis: analysis as import("@/lib/supabase/database.types").Json,
      })
      .select("id")
      .single();

    if (error) throw error;

    // Mark meeting as ended
    await supabase
      .from("live_meetings")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", body.meetingId);

    await persistInstitutionalMeetingRecord(supabase, {
      meeting,
      actorId: user.id,
      participants: body.participants ?? [],
      transcript,
      analysis,
      // When the meeting happened, not when the report ran. Usually moments
      // apart; an hour or more apart whenever this is reached by the room's
      // retry, and a different day whenever a host ends a meeting the next
      // morning.
      occurredAt: meeting.started_at ?? meeting.scheduled_at ?? null,
    });

    // A task for each action item, on the list of whoever the item names.
    //
    // Awaited, not fired off. This used to be `void Promise.allSettled(...)` on
    // the line before the response: on a serverless runtime the invocation can
    // be frozen the moment the response is sent, so any insert that had not
    // landed simply never did — silently, because nothing was waiting to hear.
    // The inserts run in parallel and cost one round trip.
    let tasks = { created: 0, routed: 0, unrouted: [] as string[], skipped: 0 };
    const actionItems = normalizeNoteList(analysis.action_items);
    if (actionItems.length > 0 && meeting.organization_id) {
      // Loaded only when an item actually names somebody — most of the cost of
      // this route is the model call, and there is no reason to add two table
      // reads to a report whose items are all unowned.
      const named = actionItems.some((item) => parseActionItem(item).owner);
      tasks = await createActionItemTasks(supabase, {
        orgId: meeting.organization_id,
        // Stamped on each task, and how a retry after a lost response is
        // spotted: the same commitment must not reach a colleague twice.
        meetingId: body.meetingId,
        hostId: user.id,
        meetingTitle: meeting.title ?? body.title ?? "Untitled",
        dealId: meeting.deal_id ?? null,
        summary: normalizeNoteText(analysis.summary),
        items: actionItems,
        directory: named ? await loadOrgDirectory(supabase, meeting.organization_id) : [],
      });
    }

    return NextResponse.json({ reportId: report.id, analysis, tasks });
  } catch (err) {
    console.error("[/api/meetings/report]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate report" },
      { status: 500 },
    );
  }
}
